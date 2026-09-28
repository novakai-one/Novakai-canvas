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
  ReadLease,
  Request,
  ResourceAdmission,
  ResourceLease,
  Snapshot,
} from '../../contract/records/capability-types.js';
import type { ResourceSelector } from '../../contract/ports/workspace.js';
import type { ResourceSelection } from '../../contract/records/planning/selection.js';
import type { CapabilityFailure } from '../../contract/records/transport/failure-source.js';
import { authoringFailure, success } from '../../contract/errors.js';

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
  return {
    acquire: async (request, snapshot) => holdRequestFiles(request, snapshot, selector, assets),
  };
}

/** Picks the files the request uses, asks Assets to hold them, and describes the hold. */
function holdRequestFiles(
  request: Request,
  snapshot: Snapshot,
  selector: Pick<ResourceSelector, 'select'>,
  assets: Pick<Assets, 'acquire'>,
): AuthoringResult<ResourceLease> {
  const selection = selector.select(request, snapshot);
  if (!selection.ok) {
    return selection;
  }
  const hold = assets.acquire(selection.value.fileDigests);
  if (!hold.ok) {
    return unheldFilesFailure(hold.error);
  }
  const lease = describeLease(selection.value, hold.value);
  return success(lease);
}

/** Describes the hold: the pick, the records it read, the files held, and how to let go. */
function describeLease(
  selection: ResourceSelection,
  hold: ReadLease,
): ResourceLease {
  return {
    pins: selection.resourcesJson,
    reads: selection.reads,
    covered: selection.fileDigests,
    release: async () => letGo(hold),
  };
}

/** Asks Assets to let go of the held files. */
function letGo(hold: ReadLease): AuthoringResult<void> {
  const released = hold.release();
  if (!released.ok) {
    return releaseFailure(released.error);
  }
  return success(undefined);
}

/** Makes the mistake for files Assets couldn't hold, keeping Assets' own. */
function unheldFilesFailure(assetFailure: CapabilityFailure): AuthoringResult<never> {
  return authoringFailure(
    'missing-asset',
    assetFailure.path,
    assetFailure.message,
    [],
    assetFailure,
  );
}

/** Makes the mistake for a hold Assets couldn't let go of; Assets keeps the hold until clean-up. */
function releaseFailure(assetFailure: CapabilityFailure): AuthoringResult<never> {
  return authoringFailure(
    'storage-unavailable',
    assetFailure.path,
    assetFailure.message,
    [],
    assetFailure,
  );
}
