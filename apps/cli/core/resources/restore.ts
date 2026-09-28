/*
 * Why this file exists
 *
 * A kept request can be sent again long after it was built, even after the service restarted. If
 * the change uses `./logo.png`, the service may no longer hold those bytes, and the change would
 * fail. So the CLI keeps a copy of each font and image's bytes with the request.
 *
 * This file stores those copies in the service again, just before each send. It never sends the
 * change. If a copy can't be stored, the change isn't sent, and the copies stay kept for a retry.
 */
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { ByteBackup } from '../../contract/records/retained-request.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { combined } from '../shared/results.js';

/** The tool restoring uses: the service's call that stores kept bytes again. */
export interface RestoreDependencies {
  readonly resources: Pick<ServiceResources, 'restore'>;
}

/**
 * Stores each kept copy of font and image bytes in the service again, before a request is sent.
 * The mistake it can find: a copy the service won't store. The first such failure is given back.
 */
export async function restoreResources(
  backups: readonly ByteBackup[],
  dependencies: RestoreDependencies,
): Promise<Result<void>> {
  const restores = await restoreEachBackup(backups, dependencies);
  const restored = combined(restores);
  if (!restored.ok) {
    return restored;
  }
  return success(undefined);
}

/** Asks the service to store every kept copy again, all at once, and gives back each answer. */
function restoreEachBackup(
  backups: readonly ByteBackup[],
  dependencies: RestoreDependencies,
): Promise<readonly Result<void>[]> {
  const restoreCalls = backups.map((backup) => dependencies.resources.restore(backup));
  return Promise.all(restoreCalls);
}
