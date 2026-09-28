/*
 * Why this file exists
 *
 * Authoring saves every change, but it doesn't know about SQLite. It asks for three things: read
 * the workspace, find a request's receipt (the saved record of a finished request), and commit a
 * change. Persistence does the storing, and has its own mistake codes. For example, Persistence
 * says `missing-resource` where Authoring says `missing-asset`.
 *
 * This file joins the two: it gives Authoring those three roles, backed by Persistence, and turns
 * each storage mistake into Authoring's code, keeping Persistence's detail. It never decides
 * whether a change is allowed; Authoring does.
 */
import { receiptSchema, failure } from '@novakai/canvas-authoring';
import type {
  Result,
  Receipt,
  WorkspaceId,
  RequestId,
  CommitRequest,
  ErrorCode,
} from '@novakai/canvas-authoring';
import type {
  Result as StorageResult,
  StorageError,
  WorkspaceState,
} from '@novakai/canvas-persistence';
import type { AuthoringStore, ConditionalStorage } from '../../contract/ports/storage.js';
import { success } from '../../contract/errors.js';

/**
 * Gives Authoring its three storage roles (read the workspace, find a receipt, commit), backed by
 * `storage`. Finding a receipt answers `null` when none is stored.
 * `storage` holds one workspace, and the store serves only that one: asking for any other gives
 * `permission-denied` at `workspace`. A stored receipt that can't be read gives `corrupt-record`
 * at `receipt`. Persistence's own mistakes come back as Authoring codes.
 */
export function createAuthoringStore(storage: ConditionalStorage): AuthoringStore {
  const bridge: StoreBridge = { storage, views: new WeakMap() };
  return {
    snapshots: { read: async (workspace) => readSnapshotView(bridge, workspace) },
    receipts: { find: async (workspace, request) => findReceipt(bridge, workspace, request) },
    commits: { commit: async (request) => commitChange(bridge, request) },
  };
}

/** One store's storage and its view cache. */
interface StoreBridge {
  readonly storage: ConditionalStorage;
  /** Same stored slots → same frozen view, so Authoring's parse caches hit. */
  readonly views: WeakMap<WorkspaceState['slots'], SnapshotView>;
}

/**
 * The raw snapshot Authoring parses: the stored workspace, its commit sequence and its record
 * slots, unchecked. Authoring alone checks the shape.
 */
interface SnapshotView {
  readonly workspace: WorkspaceState['workspace'];
  readonly sequence: WorkspaceState['sequence'];
  readonly records: WorkspaceState['slots'];
}

/** The Authoring code of each Persistence failure code. Every storage code has a row (checked by the type). */
const STORAGE_CODES: Readonly<Record<StorageError['code'], ErrorCode>> = Object.freeze({
  'invalid-input': 'invalid-input',
  'unsupported-version': 'unsupported-version',
  'revision-conflict': 'revision-conflict',
  'request-reused': 'request-reused',
  'storage-unavailable': 'storage-unavailable',
  'corrupt-record': 'corrupt-record',
  'missing-resource': 'missing-asset',
  'destination-not-empty': 'revision-conflict',
});

/** Storage mistakes point at a path, never at diagram objects. */
const NO_TARGETS: readonly string[] = Object.freeze([]);

/** Reads the stored workspace for Authoring, unchecked, once it is sure it is the one asked for. */
function readSnapshotView(
  bridge: StoreBridge,
  workspace: WorkspaceId,
): Result<SnapshotView> {
  const stored = inAuthoringTerms(bridge.storage.readSnapshot());
  if (!stored.ok) {
    return stored;
  }
  if (!isStoredWorkspace(stored.value, workspace)) {
    return otherWorkspaceFailure();
  }
  const view = cachedView(bridge.views, stored.value);
  return success(view);
}

/** Whether the stored workspace is the one asked for. */
function isStoredWorkspace(
  state: WorkspaceState,
  workspace: WorkspaceId,
): boolean {
  const storedWorkspace = String(state.workspace);
  return storedWorkspace === workspace;
}

/**
 * Finds the saved receipt of `request`, or `null` when none is stored; a missing receipt is not a
 * mistake. The workspace is checked first, as `readSnapshotView` checks it.
 */
function findReceipt(
  bridge: StoreBridge,
  workspace: WorkspaceId,
  request: RequestId,
): Result<Receipt | null> {
  const snapshot = readSnapshotView(bridge, workspace);
  if (!snapshot.ok) {
    return snapshot;
  }
  const stored = inAuthoringTerms(bridge.storage.receipt(request));
  if (!stored.ok) {
    return stored;
  }
  return checkFoundReceipt(stored.value);
}

/** Checks a found receipt, or answers `null` when none was stored. */
function checkFoundReceipt(stored: unknown): Result<Receipt | null> {
  if (stored === null) {
    return success(null);
  }
  return checkReceipt(stored);
}

/**
 * Commits the request in one conditional storage transaction, after checking the workspace as
 * `readSnapshotView` does. Expected versions and the receipt fingerprint pass through unchanged.
 */
function commitChange(
  bridge: StoreBridge,
  request: CommitRequest,
): Result<Receipt> {
  const snapshot = readSnapshotView(bridge, request.workspace);
  if (!snapshot.ok) {
    return snapshot;
  }
  const written = inAuthoringTerms(bridge.storage.commit(request));
  if (!written.ok) {
    return written;
  }
  return checkReceipt(written.value);
}

/** Gives storage's answer in Authoring's terms; a stored value passes through as it is. */
function inAuthoringTerms<T>(stored: StorageResult<T>): Result<T> {
  if (!stored.ok) {
    return storageFailure(stored.error);
  }
  return success(stored.value);
}

/** Gives back the frozen view made before for these same slots, or makes and keeps a new one. */
function cachedView(
  views: StoreBridge['views'],
  state: WorkspaceState,
): SnapshotView {
  const known = views.get(state.slots);
  if (known !== undefined && showsSameState(known, state)) {
    return known;
  }
  const fresh = freezeView(state);
  views.set(state.slots, fresh);
  return fresh;
}

/** Whether the view shows the same stored workspace and commit sequence as `state`. */
function showsSameState(
  view: SnapshotView,
  state: WorkspaceState,
): boolean {
  const sameWorkspace = view.workspace === state.workspace;
  const sameSequence = view.sequence === state.sequence;
  return sameWorkspace && sameSequence;
}

/** Makes a frozen view of the stored state for Authoring to parse. */
function freezeView(state: WorkspaceState): SnapshotView {
  const view: SnapshotView = {
    workspace: state.workspace,
    sequence: state.sequence,
    records: state.slots,
  };
  return Object.freeze(view);
}

/** Checks a stored receipt with Authoring's receipt schema before it reaches a client. */
function checkReceipt(stored: unknown): Result<Receipt> {
  const receipt = receiptSchema.safeParse(stored);
  if (!receipt.success) {
    return corruptReceiptFailure();
  }
  return success(receipt.data);
}

/**
 * Makes Authoring's mistake from a storage mistake: the matching code (see `STORAGE_CODES`), the
 * same path and message, and storage's mistake kept as the source. Authoring then reconciles
 * receipts rather than retrying blindly.
 */
function storageFailure(storageError: StorageError): Result<never> {
  const code = STORAGE_CODES[storageError.code];
  return failure(code, storageError.path, storageError.message, NO_TARGETS, storageError);
}

/** Makes the mistake for a workspace this store doesn't serve. */
function otherWorkspaceFailure(): Result<never> {
  return failure(
    'permission-denied',
    'workspace',
    'Workspace does not belong to this service session',
  );
}

/** Makes the mistake for a stored receipt that can't be read. */
function corruptReceiptFailure(): Result<never> {
  return failure('corrupt-record', 'receipt', 'Stored receipt cannot be decoded');
}
