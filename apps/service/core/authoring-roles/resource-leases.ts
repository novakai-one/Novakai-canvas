/*
 * Why this file exists
 *
 * A change can use stored files, like a theme's fonts or a diagram's images. If clean-up removed
 * one while Authoring was still saving the change, the saved diagram would point at a missing file.
 * So Authoring first holds every file the request uses (a "lease"), and lets go once the save is
 * settled. For example, a DSL change showing a logo holds the logo's file until its receipt exists.
 *
 * This file builds that hold for Authoring. It asks the selector which files the request uses and
 * asks Assets to hold them. It never writes records. If letting go fails, Assets keeps the hold.
 */
import type {
  Assets,
  AuthoringResult,
  Request,
  ResourceAdmission,
  ResourceLease,
  Snapshot,
} from '../../contract/records/capability-types.js';
import type { ResourceSelector } from '../../contract/ports/workspace.js';
import { authoringFailure } from '../../contract/errors.js';

/**
 * Builds Authoring's file hold (`ResourceAdmission`). Its `acquire` picks the files a request uses,
 * holds them, and answers the hold (`ResourceLease`), whose `release` lets go.
 * Mistakes: the selector's own, or `missing-asset` when a file can't be held. `release` answers
 * `storage-unavailable` when letting go fails.
 */
export function createResourceAdmission(
  selector: Pick<ResourceSelector, 'select'>,
  assets: Pick<Assets, 'acquire'>,
): ResourceAdmission {
  return { acquire: async (request, snapshot) => acquire(request, snapshot, selector, assets) };
}
/** Physical byte protection lasts through authoritative commit/receipt settlement, including prior inverse-history resources. */
function acquire(
  request: Request,
  snapshot: Snapshot,
  selector: Pick<ResourceSelector, 'select'>,
  assets: Pick<Assets, 'acquire'>,
): AuthoringResult<ResourceLease> {
  const selected = selector.select(request, snapshot);
  if (!selected.ok) return selected;
  const lease = assets.acquire(selected.value.fileDigests);
  if (!lease.ok)
    return authoringFailure(
      'missing-asset',
      lease.error.path,
      lease.error.message,
      [],
      lease.error,
    );
  return {
    ok: true,
    value: {
      pins: selected.value.resourcesJson,
      reads: selected.value.reads,
      covered: selected.value.fileDigests,
      release: async () => released(lease.value.release()),
    },
  };
}
/** Release failure remains typed; Assets conservatively retains protection for maintenance recovery. */
function released(result: ReturnType<Assets['close']>): AuthoringResult<void> {
  if (result.ok) return result;
  return authoringFailure(
    'storage-unavailable',
    result.error.path,
    result.error.message,
    [],
    result.error,
  );
}
