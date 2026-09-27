/*
 * Byte restoration before every Authoring submission: restage each retained byte backup with
 * Assets, so a request replayed after a service restart still finds its bytes. Uses injected ports
 * only. A failure stops before the Authoring request is sent; the backups stay in the retained
 * request for the next `retry`.
 */
import type { ByteBackup } from '../../contract/records/retained-request.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { combined } from '../shared/results.js';
import { resourceCall } from './stage.js';
import type { ResourcePoster } from './stage.js';

/**
 * Restage exact normalized bytes before admission; receipt reconciliation has already established
 * no commit exists. Restore failures stop before canonical admission, while successful backups
 * remain safe to replay. Fails as the first failed `/resources/restore` call does.
 */
export async function restoreResources(
  backups: readonly ByteBackup[],
  dependencies: ResourcePoster,
): Promise<Result<void>> {
  const result = combined(
    await Promise.all(backups.map((backup) => resourceCall('restore', backup, dependencies))),
  );
  if (!result.ok) return result;
  return success(undefined);
}
