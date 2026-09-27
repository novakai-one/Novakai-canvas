/*
 * Byte restoration before every Authoring submission: restage each retained byte backup with
 * Assets, so a request replayed after a service restart still finds its bytes. Uses injected ports
 * only. A failure stops before the Authoring request is sent; the backups stay in the retained
 * request for the next `retry`.
 */
import type { RequestDraft } from '../../contract/ports/runtime.js';
import type { ByteBackup } from '../../contract/records/resources.js';
import type { Result } from '../../contract/errors.js';
import { combined } from '../shared/results.js';
import { resourceCall } from './stage.js';
import type { ResourceDependencies } from './stage.js';

/** Restage exact normalized bytes before admission; receipt reconciliation has already established no commit exists. */
export async function restoreResources(
  draft: RequestDraft,
  dependencies: Pick<ResourceDependencies, 'transport'>,
): Promise<Result<void>> {
  return restoreBackups(draft.backups ?? [], dependencies);
}
/** Restore failures stop before canonical admission, while successful backups remain safe to replay. */
async function restoreBackups(
  backups: readonly ByteBackup[],
  dependencies: Pick<ResourceDependencies, 'transport'>,
): Promise<Result<void>> {
  const result = combined(
    await Promise.all(backups.map((backup) => resourceCall('restore', backup, dependencies))),
  );
  if (!result.ok) return result;
  return { ok: true, value: undefined };
}
