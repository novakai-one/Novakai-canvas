import { digest } from './brands.js';
import type { LeaseId } from './brands.js';
import type { Result } from './errors.js';
import { digestList } from './records/lease.js';
import type { ReadLease, WriteLease, Assets, AssetDependencies } from './types.js';
import type { StoredBlob } from './records/media.js';
import { parse, protect, protectAsync, success } from '../core/validation/outcomes.js';
import { stageMedia } from '../core/admission/stage.js';
import { resolveBlob } from '../core/resolution/resolve.js';
import type { LeaseMode } from '../core/reachability/leases.js';
import {
  createLease,
  readLeased,
  prepareRestored,
  stageReserved,
} from '../core/reachability/leases.js';
import { collectBlobs } from '../core/reachability/collect.js';

/**
 * Builds the Assets facade over the given storage, hasher and media processors. The dependencies
 * are bound once; callers see only the {@link Assets} contract. Diagram bindings to assets belong
 * to Authoring; recovering media and leases belongs to Assets. No I/O happens here.
 *
 * Every method checks its own input, so direct JavaScript callers get the same checks. Every
 * method returns a deeply frozen result and never throws. A throw is reported where it is caught:
 * - inside a transaction of the real storage adapter: a `StorageFault` keeps its code (for
 *   example `corrupt-asset`); anything else is `storage-unavailable`;
 * - while staging, or while checking backup bytes (`verify`, `WriteLease.stage`): `unsafe-media`;
 * - anywhere else: `storage-unavailable`.
 *
 * See {@link Assets} for each method's failure codes.
 *
 * @param deps - The storage, identity (hashing, lease IDs, process ownership) and media registry.
 * @returns The frozen facade.
 * @throws Never.
 */
export function createAssets(deps: AssetDependencies): Assets {
  return Object.freeze({
    /** Stages media; its own boundary reports throws as `unsafe-media`. */
    stage: (input) => stageMedia(input, deps),
    /** Reads and verifies one blob. */
    resolve: (input) => protect(() => resolveInput(input, deps)),
    /** Leases existing, verified blobs. */
    acquire: (input) => protect(() => acquire(input, deps)),
    /** Leases digests whose bytes may be absent. */
    reserve: (input) => protect(() => reserve(input, deps)),
    /** Checks backup bytes without storing them. */
    verify: (input, base64) => protectAsync(() => verify(input, base64, deps)),
    /** Collects unreferenced blobs in one storage transaction. */
    collectUnreferenced: (reader) =>
      protect(() => deps.storage.transact((view) => collectBlobs(view, deps.identity, reader))),
    /** Closes storage. */
    close: () => protect(() => deps.storage.close()),
  } satisfies Assets);
}

/** Checks the digest, then reads and verifies its bytes in a storage transaction. */
function resolveInput(
  input: unknown,
  deps: AssetDependencies,
): Result<StoredBlob> {
  const parsed = parse(digest, input);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.storage.transact((view) => resolveBlob(view, parsed.value, deps.identity));
}

/** Checks the digest, then re-checks the lease covers it and verifies its bytes. */
function readLeaseInput(
  id: LeaseId,
  input: unknown,
  deps: AssetDependencies,
): Result<StoredBlob> {
  const parsed = parse(digest, input);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.storage.transact((view) => readLeased(view, id, parsed.value, deps.identity));
}

/**
 * Checks the digest list, removes duplicates, sorts it and records a new lease. In `acquire`
 * mode, every digest's bytes are verified before the lease is recorded.
 */
function openLease(
  input: unknown,
  mode: LeaseMode,
  deps: AssetDependencies,
): Result<LeaseId> {
  const parsed = parse(digestList, input);
  if (!parsed.ok) {
    return parsed;
  }
  const digests = [...new Set(parsed.value)].sort();
  const created = deps.storage.transact((view) => createLease(view, digests, mode, deps.identity));
  if (!created.ok) {
    return created;
  }
  return success(created.value.id);
}

/** Deletes the lease. Releasing twice is not an error; storage failures are returned. */
function releaseLease(
  id: LeaseId,
  deps: AssetDependencies,
): Result<void> {
  return protect(() =>
    deps.storage.transact((view) => {
      view.deleteLease(id);
      return success(undefined);
    }),
  );
}

/** Leases existing, verified digests and returns a lease that reads and releases them. */
function acquire(
  input: unknown,
  deps: AssetDependencies,
): Result<ReadLease> {
  const opened = openLease(input, 'acquire', deps);
  if (!opened.ok) {
    return opened;
  }
  const id = opened.value;
  return success({
    id,
    /** Reads one leased blob, re-checking the lease each time. */
    read: (requested) => protect(() => readLeaseInput(id, requested, deps)),
    /** Deletes the lease. */
    release: () => releaseLease(id, deps),
  });
}

/** Leases digests whose bytes may be absent and returns a lease that installs and releases them. */
function reserve(
  input: unknown,
  deps: AssetDependencies,
): Result<WriteLease> {
  const opened = openLease(input, 'reserve', deps);
  if (!opened.ok) {
    return opened;
  }
  const id = opened.value;
  return success({
    id,
    /** Installs checked backup bytes for one reserved digest. */
    stage: (requested, base64) => protectAsync(() => stageLeased(id, requested, base64, deps)),
    /** Deletes the lease. */
    release: () => releaseLease(id, deps),
  });
}

/**
 * Checks the digest, then validates the backup bytes and installs them under the lease. The
 * validation is asynchronous; the lease is checked afterwards, in the transaction that writes them.
 */
async function stageLeased(
  id: LeaseId,
  input: unknown,
  base64: unknown,
  deps: AssetDependencies,
): Promise<Result<void>> {
  const parsed = parse(digest, input);
  if (!parsed.ok) {
    return parsed;
  }
  return stageReserved(deps.storage, id, parsed.value, base64, deps.media, deps.identity);
}

/** Checks that backup bytes hash to the digest and normalize to the same bytes. Stores nothing. */
async function verify(
  input: unknown,
  base64: unknown,
  deps: AssetDependencies,
): Promise<Result<void>> {
  const parsed = parse(digest, input);
  if (!parsed.ok) {
    return parsed;
  }
  const checked = await prepareRestored(parsed.value, base64, deps.media, deps.identity);
  if (!checked.ok) {
    return checked;
  }
  return success(undefined);
}
