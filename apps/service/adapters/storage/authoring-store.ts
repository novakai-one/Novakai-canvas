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
    snapshots: { read: async (workspace) => rawSnapshot(bridge, workspace) },
    receipts: { find: async (workspace, request) => receipt(bridge, workspace, request) },
    commits: { commit: async (request) => commit(bridge, request) },
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

/**
 * The stored snapshot as Authoring reads it, unchecked. Fails with `permission-denied` at
 * `workspace` when the stored workspace is not `workspace`, and as `translated` when storage
 * cannot read it.
 */
function rawSnapshot(
  bridge: StoreBridge,
  workspace: WorkspaceId,
): Result<SnapshotView> {
  const current = translated(bridge.storage.readSnapshot());
  if (!current.ok) return current;
  if (String(current.value.workspace) !== workspace)
    return failure(
      'permission-denied',
      'workspace',
      'Workspace does not belong to this service session',
    );
  return { ok: true, value: cachedView(bridge.views, current.value) };
}

/**
 * The committed receipt of `request`, or `null` when none is stored; absence is never a failure.
 * Fails as `rawSnapshot` for the workspace check, as `translated` when storage cannot read the
 * receipt, and as `checkedReceipt` when the stored receipt cannot be decoded.
 */
function receipt(
  bridge: StoreBridge,
  workspace: WorkspaceId,
  request: RequestId,
): Result<Receipt | null> {
  const current = rawSnapshot(bridge, workspace);
  if (!current.ok) return current;
  const stored = translated(bridge.storage.receipt(request));
  return foundReceipt(stored);
}

/**
 * The stored receipt, checked, or `null` when none is stored. A storage failure passes through
 * unchanged; fails as `checkedReceipt` when the receipt cannot be decoded.
 */
function foundReceipt(stored: Result<unknown>): Result<Receipt | null> {
  if (!stored.ok) return stored;
  if (stored.value === null) return { ok: true, value: null };
  return checkedReceipt(stored.value);
}

/**
 * Commits the request in one conditional storage transaction; expected versions and the receipt
 * fingerprint cross unchanged. Fails as `rawSnapshot` for the workspace check, as `translated`
 * when storage refuses the commit, and as `checkedReceipt` when the written receipt cannot be
 * decoded.
 */
function commit(
  bridge: StoreBridge,
  request: CommitRequest,
): Result<Receipt> {
  const current = rawSnapshot(bridge, request.workspace);
  if (!current.ok) return current;
  const written = translated(bridge.storage.commit(request));
  if (!written.ok) return written;
  return checkedReceipt(written.value);
}

/**
 * The storage outcome under Authoring's code (see `STORAGE_CODES`), the Persistence failure kept
 * as source, so Authoring reconciles receipts rather than retrying blindly. Success passes through.
 */
function translated<T>(stored: StorageResult<T>): Result<T> {
  if (stored.ok) return stored;
  const error = stored.error;
  return failure(STORAGE_CODES[error.code], error.path, error.message, [], error);
}

/** The frozen view of the stored state; the cached one while the slots, workspace and sequence are unchanged. */
function cachedView(
  views: StoreBridge['views'],
  state: WorkspaceState,
): SnapshotView {
  const known = views.get(state.slots);
  if (
    known !== undefined &&
    known.workspace === state.workspace &&
    known.sequence === state.sequence
  )
    return known;
  const view = Object.freeze({
    workspace: state.workspace,
    sequence: state.sequence,
    records: state.slots,
  });
  views.set(state.slots, view);
  return view;
}

/**
 * The stored receipt, checked against Authoring's receipt schema before it reaches clients.
 * Fails with `corrupt-record` at `receipt` when it cannot be decoded.
 */
function checkedReceipt(stored: unknown): Result<Receipt> {
  const parsed = receiptSchema.safeParse(stored);
  if (!parsed.success)
    return failure('corrupt-record', 'receipt', 'Stored receipt cannot be decoded');
  return { ok: true, value: parsed.data };
}
