import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type {
  RestoreResources,
  RestoreLease,
  ValidateDomain,
} from '../../contract/ports/resources.js';
import type { StorePort, Decision } from '../../contract/ports/store.js';
import { backupBundle } from '../../contract/records/backup.js';
import type { BackupBundle } from '../../contract/records/backup.js';
import type { WorkspaceState } from '../../contract/records/storage.js';
import {
  BACKUP_JSON_LIMIT,
  boundedClone,
  parse,
  protect,
  protectAsync,
  success,
} from '../validation/outcomes.js';
import { validateState } from '../validation/state.js';
import { checkCoverage, reachableResources, verifyResources, withLease } from './resources.js';

/**
 * Restores a backup bundle into this store's location, which must never have been committed to.
 *
 * Steps, in order; the first failure stops the restore:
 * 1. Copy and check the bundle against the backup schema and {@link BACKUP_JSON_LIMIT}, then
 *    check its state's structure. Failures, including a throw, are `corrupt-record`.
 * 2. Check the blobs are exactly the assets the state references: `corrupt-record`, path `blobs`.
 * 3. Verify every blob's bytes (all checks settle).
 * 4. Run the injected domain validation. Verified bytes alone do not prove the documents are
 *    valid, so this step is mandatory.
 * 5. Reserve the referenced assets at the destination, so garbage collection cannot remove newly
 *    staged bytes before the documents referencing them are installed.
 * 6. Stage every blob (all stages settle), then, in one store transaction, validate the
 *    destination's state, check it belongs to the same workspace, then check it is empty, and
 *    install the state. Another workspace is `invalid-input`; a used destination of the same
 *    workspace is `destination-not-empty`.
 * 7. Release the reservation, whatever happened. A failed release replaces the result.
 *
 * A known failure before the install leaves the destination's documents unchanged. The host never
 * switches to the restored location automatically; after an uncertain install
 * (`storage-unavailable`) it must reopen and inspect the destination before retrying or
 * activating it. A throw or rejection from any provider becomes `storage-unavailable`.
 *
 * @param input - The untrusted backup bundle.
 * @param resources - The Assets verifier and reservation provider.
 * @param validateDomain - The host's Model/Library and reference validation.
 * @param store - The destination store.
 * @returns Success once the state is installed, or the first failure.
 */
export function restoreBackup(
  input: unknown,
  resources: RestoreResources,
  validateDomain: ValidateDomain,
  store: Pick<StorePort, 'transact'>,
): Promise<Result<void>> {
  return protectAsync(() => restoreChecked(input, resources, validateDomain, store));
}

/** Steps 1–2: read and check the bundle and its coverage, then continue with the checked bundle. */
async function restoreChecked(
  input: unknown,
  resources: RestoreResources,
  validateDomain: ValidateDomain,
  store: Pick<StorePort, 'transact'>,
): Promise<Result<void>> {
  const bundle = protect(() => readBundle(input), 'corrupt-record');
  if (!bundle.ok) {
    return bundle;
  }
  const coverage = checkCoverage(bundle.value.state, bundle.value.blobs);
  if (!coverage.ok) {
    return coverage;
  }
  return validateAndInstall(bundle.value, resources, validateDomain, store);
}

/**
 * Copies and checks the whole bundle, then checks its state's structure, before any destination
 * bytes are staged.
 */
function readBundle(input: unknown): Result<BackupBundle> {
  const parsed = parse(backupBundle, boundedClone(input, BACKUP_JSON_LIMIT), 'corrupt-record');
  if (!parsed.ok) {
    return parsed;
  }
  const state = validateState(parsed.value.state);
  if (!state.ok) {
    return state;
  }
  return success(parsed.value);
}

/** Steps 3–4: verify the bytes, then run the mandatory domain validation. */
async function validateAndInstall(
  bundle: BackupBundle,
  resources: RestoreResources,
  validateDomain: ValidateDomain,
  store: Pick<StorePort, 'transact'>,
): Promise<Result<void>> {
  const verified = await verifyResources(bundle.blobs, resources.verify);
  if (!verified.ok) {
    return verified;
  }
  const domain = await validateDomain(bundle.state);
  if (!domain.ok) {
    return domain;
  }
  return reserveAndInstall(bundle, resources, store);
}

/** Steps 5 and 7: reserve the assets, stage and install under the reservation, then release it. */
async function reserveAndInstall(
  bundle: BackupBundle,
  resources: RestoreResources,
  store: Pick<StorePort, 'transact'>,
): Promise<Result<void>> {
  const reserved = await resources.reserve(reachableResources(bundle.state));
  if (!reserved.ok) {
    return reserved;
  }
  return withLease(reserved.value, () => stageAndInstall(bundle, reserved.value, store));
}

/**
 * Step 6: stages every blob and waits for all of them, then installs the state in one store
 * transaction. No document is installed until every blob is staged.
 */
async function stageAndInstall(
  bundle: BackupBundle,
  lease: RestoreLease,
  store: Pick<StorePort, 'transact'>,
): Promise<Result<void>> {
  const results = await Promise.all(
    bundle.blobs.map((blob) => protectAsync(() => lease.stage(blob.digest, blob.base64))),
  );
  const failed = results.find((result) => !result.ok);
  // `find` does not narrow the type; `!failed.ok` does.
  if (failed !== undefined && !failed.ok) {
    return failed;
  }
  return protect(
    () => store.transact((raw) => installIntoPristine(raw, bundle.state)),
    'storage-unavailable',
  );
}

/**
 * Inside the install transaction: validates the destination's current state and checks it
 * belongs to the same workspace, then chooses the decision.
 */
function installIntoPristine(
  raw: unknown,
  restored: WorkspaceState,
): Result<Decision<void>> {
  const current = validateState(raw);
  if (!current.ok) {
    return current;
  }
  if (current.value.workspace !== restored.workspace) {
    return fail('invalid-input', 'workspace', 'Restore must preserve logical workspace identity');
  }
  return chooseDestination(current.value, restored);
}

/**
 * Installs only into a destination that was never committed to (sequence 0). A workspace whose
 * collections were all deleted is not empty.
 */
function chooseDestination(
  current: WorkspaceState,
  restored: WorkspaceState,
): Result<Decision<void>> {
  if (current.sequence !== 0) {
    return fail('destination-not-empty', '$', 'Restore destination has already been used');
  }
  return success({ state: restored, value: undefined });
}
