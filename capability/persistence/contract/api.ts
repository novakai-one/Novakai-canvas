import { requestId } from './brands.js';
import { fail } from './errors.js';
import type { Result } from './errors.js';
import type { Persistence } from './types.js';
import type { Decision, StorePort } from './ports/store.js';
import type { WorkspaceId } from './brands.js';
import type { WorkspaceState, Receipt } from './records/storage.js';
import { validateState, isAdmitted } from '../core/validation/state.js';
import { validateRequest } from '../core/validation/request.js';
import { freeze, parse, protect, protectAsync, success } from '../core/validation/outcomes.js';
import { planCommit } from '../core/transaction/commit.js';
import { createBackup } from '../core/recovery/backup.js';
import { restoreBackup } from '../core/recovery/restore.js';

/**
 * Binds a trusted store to one workspace and returns the Persistence service.
 *
 * Every operation that reads state validates the stored state and checks it belongs to
 * `workspace` before any storage policy runs. The store itself never escapes the returned object.
 * Data Persistence produces is detached and frozen. A result returned by an injected provider
 * (Assets leases, domain validation) is passed on as the same object and frozen in place, not
 * copied; one the provider had already frozen at its top level is returned as is, so its nested
 * objects stay as the provider left them. Failures stay typed:
 * - `readSnapshot` and `close`: a throw becomes `storage-unavailable`.
 * - `commit` and `receipt`: a throw (for example non-JSON or oversized input) becomes
 *   `invalid-input`.
 * - `backup` and `restore`: a throw or rejection becomes `storage-unavailable`.
 *
 * Recovery owners: Authoring owns mutations and receipt reconciliation after an uncertain commit;
 * the maintenance host owns activating a restored location.
 *
 * @param store - The storage seam, for example from `createSqliteStore`.
 * @param workspace - The workspace this service serves.
 * @returns The frozen Persistence service.
 */
export function createPersistence(
  store: StorePort,
  workspace: WorkspaceId,
): Persistence {
  /** Reads one consistent, validated state. The adapter owns rollback. */
  const readSnapshot = (): Result<WorkspaceState> =>
    protect(
      () => readValidated(store, workspace, (state) => success({ state, value: state })),
      'storage-unavailable',
    );
  return Object.freeze({
    readSnapshot,
    /** Validates the request, then plans and installs the commit (receipt first). */
    commit: (input: unknown) => protect(() => commitInput(store, workspace, input)),
    /** Looks up the receipt for a request ID; `null` when none is kept. */
    receipt: (input: unknown) => protect(() => findReceipt(store, workspace, input)),
    /** Reads one consistent state, then copies it with its asset bytes into a bundle. */
    backup: (resources) =>
      protectAsync(async () => {
        const snapshot = readSnapshot();
        if (!snapshot.ok) {
          return snapshot;
        }
        return createBackup(snapshot.value, resources);
      }),
    /** Checks a bundle and installs it into this empty location. */
    restore: (input, resources, validateDomain) =>
      protectAsync(() => restoreBackup(input, resources, validateDomain, store)),
    /** Closes the store; a throw becomes `storage-unavailable`. */
    close: () => protect(() => store.close(), 'storage-unavailable'),
  } satisfies Persistence);
}

/**
 * Checks and commits one request.
 *
 * The request is copied and checked before any storage work (`invalid-input`), and must belong to
 * this workspace. Inside the transaction the receipt check comes first, so a retry of a committed
 * request returns its original receipt.
 */
function commitInput(
  store: StorePort,
  workspace: WorkspaceId,
  input: unknown,
): Result<Receipt> {
  const request = validateRequest(input);
  if (!request.ok) {
    return request;
  }
  if (request.value.workspace !== workspace) {
    return fail('invalid-input', 'workspace', 'Request belongs to another workspace');
  }
  return readValidated(store, workspace, (state) => planCommit(state, request.value));
}

/**
 * Finds the kept receipt for a request ID, or `null` when there is none. To reconcile an
 * uncertain commit, retry the original request envelope.
 */
function findReceipt(
  store: StorePort,
  workspace: WorkspaceId,
  input: unknown,
): Result<Receipt | null> {
  const checked = parse(requestId, input, 'invalid-input');
  if (!checked.ok) {
    return checked;
  }
  return readValidated(store, workspace, (state) =>
    success({
      state,
      value: state.receipts.find((receipt) => receipt.request === checked.value) ?? null,
    }),
  );
}

/** Runs `decide` on the validated stored state inside one store transaction. */
function readValidated<T>(
  store: StorePort,
  workspace: WorkspaceId,
  decide: (state: WorkspaceState) => Result<Decision<T>>,
): Result<T> {
  return store.transact((raw) => validateAndDecide(raw, workspace, decide));
}

/**
 * Validates the raw state and checks its workspace before deciding. A database can never
 * silently switch to another workspace on reopen or after a malformed write.
 */
function validateAndDecide<T>(
  raw: unknown,
  workspace: WorkspaceId,
  decide: (state: WorkspaceState) => Result<Decision<T>>,
): Result<Decision<T>> {
  const checked = validatedOnce(raw);
  if (!checked.ok) {
    return checked;
  }
  if (checked.value.workspace !== workspace) {
    return fail('invalid-input', 'workspace', 'Database belongs to another workspace');
  }
  return decide(checked.value);
}

/**
 * Successful validations by raw object. The store hands back the same parsed object while the
 * stored text is unchanged, so each object is validated once.
 */
const validated = new WeakMap<object, Result<WorkspaceState>>();

/** Validates a raw state, reusing earlier successful validations of the same object. */
function validatedOnce(raw: unknown): Result<WorkspaceState> {
  if (raw === null || typeof raw !== 'object') {
    return validateState(raw);
  }
  return validatedObject(raw);
}

/**
 * A state this module's validator already admitted is returned as is; otherwise an earlier
 * result for this object is reused, or the object is validated now.
 */
function validatedObject(raw: object): Result<WorkspaceState> {
  if (isAdmitted(raw)) {
    return success(raw);
  }
  const known = validated.get(raw);
  if (known !== undefined) {
    return known;
  }
  return validateAndRemember(raw);
}

/** Validates and freezes the result; remembers it only when it succeeded. */
function validateAndRemember(raw: object): Result<WorkspaceState> {
  const checked = freeze(validateState(raw));
  if (checked.ok) {
    validated.set(raw, checked);
  }
  return checked;
}
