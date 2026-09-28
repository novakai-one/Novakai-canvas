import type { Digest, LeaseId } from './brands.js';
import type { Result } from './errors.js';
import type { Admission, StoredBlob } from './records/media.js';
import type { AssetStorage } from './ports/storage.js';
import type { IdentityPort } from './ports/identity.js';
import type { MediaRegistry } from './ports/media.js';
import type { ReachabilityReader } from './ports/reachability.js';

/**
 * A lease from {@link Assets.acquire}. While it is held, collection keeps its digests. The object
 * is frozen; its methods never throw.
 */
export interface ReadLease {
  /** The lease's ID. */
  readonly id: LeaseId;
  /**
   * Reads one leased asset. Each call re-reads the stored lease and verifies the bytes again.
   *
   * @param digest - The digest to read. It is checked as a {@link Digest}.
   * @returns The verified, frozen blob. Fails `invalid-input` for a bad digest, `lease-expired`
   * when the lease was released or does not cover the digest, `corrupt-asset` for a malformed
   * lease record or bytes that do not match, `missing-asset` when the bytes are gone, and
   * `storage-unavailable` when storage fails.
   */
  read(digest: unknown): Result<StoredBlob>;
  /**
   * Deletes the lease. Releasing twice is not an error.
   *
   * @returns Success, or `storage-unavailable` when storage fails (for example after close).
   */
  release(): Result<void>;
}

/**
 * A lease from {@link Assets.reserve}. It protects digests whose bytes may not be stored yet, and
 * lets verified backup bytes be installed for them. The object is frozen; its methods never throw.
 */
export interface WriteLease {
  /** The lease's ID. */
  readonly id: LeaseId;
  /**
   * Installs backup bytes for one reserved digest. The bytes must hash to the digest, and
   * normalizing them (as the media type detected from the bytes) must give the same bytes. The
   * lease is checked after that, in the same storage transaction that writes the bytes, so bytes
   * are never installed after the lease is released.
   *
   * @param digest - The reserved digest. It is checked as a {@link Digest}.
   * @param base64 - The backup bytes, base64 encoded.
   * @returns Success once the bytes are stored. Fails `invalid-input` for a bad digest or bad
   * base64; `corrupt-asset` when the bytes do not match the digest, the stored lease is
   * malformed, or different bytes are already stored at the digest; `unsupported-media` or
   * `unsafe-media` when the media is rejected; `lease-expired` when the lease no longer covers
   * the digest; `missing-asset` when stored bytes vanish between two reads; and
   * `storage-unavailable` when storage fails.
   */
  stage(
    digest: unknown,
    base64: unknown,
  ): Promise<Result<void>>;
  /**
   * Deletes the lease. Releasing twice is not an error.
   *
   * @returns Success, or `storage-unavailable` when storage fails (for example after close).
   */
  release(): Result<void>;
}

/** The outcome of {@link Assets.collectUnreferenced}. Both lists keep the order storage lists them in. */
export interface CollectionReport {
  /** Digests whose bytes were deleted. */
  readonly removed: readonly Digest[];
  /** Digests whose bytes were kept because something references or leases them. */
  readonly retained: readonly Digest[];
}

/** The services Assets is built from. `createAssets` binds them once. */
export interface AssetDependencies {
  /** Transactional storage for bytes and leases. */
  readonly storage: AssetStorage;
  /** Hashing, lease IDs and process ownership. */
  readonly identity: IdentityPort;
  /** The media processors and byte-signature detection. */
  readonly media: MediaRegistry;
}

/**
 * The Assets facade: stores content-addressed media and protects it with leases. Callers see only
 * this contract. The object is frozen, and every result is deeply frozen.
 *
 * Its methods never throw. A throw is reported where it is caught:
 * - inside a transaction of the real storage adapter: a `StorageFault` keeps its code (for
 *   example `corrupt-asset`); anything else is `storage-unavailable`;
 * - while staging, or while checking backup bytes (`verify`, `WriteLease.stage`): `unsafe-media`;
 * - anywhere else: `storage-unavailable`.
 *
 * Recovery: Authoring owns retrying a submission and committing bindings; Assets owns lease
 * recovery and cleaning up orphan bytes (`collectUnreferenced`). After `storage-unavailable`,
 * re-read before retrying.
 */
export interface Assets {
  /**
   * Validates, normalizes and stores one media file. It creates no diagram binding; Authoring
   * uses the admission's alt text and provenance when it commits one.
   *
   * @param input - `{ base64, mediaType, alt, provenance }`. Alt text is required except for
   * fonts.
   * @returns The admission: the stored blob's descriptor, the digest of the original bytes, and
   * the alt text and provenance. Fails `invalid-input` for bad input or bytes that cannot be
   * hashed, `unsupported-media` or `unsafe-media` when the media is rejected, `corrupt-asset`
   * when bytes already stored at the digest differ or fail verification, `missing-asset` when
   * those bytes vanish between two reads, and `storage-unavailable` when storage fails.
   */
  stage(input: unknown): Promise<Result<Admission>>;
  /**
   * Reads one stored asset and verifies its bytes against its digest and length.
   *
   * @param digest - The digest to read. It is checked as a {@link Digest}.
   * @returns The verified blob. Fails `invalid-input`, `missing-asset`, `corrupt-asset` or
   * `storage-unavailable`.
   */
  resolve(digest: unknown): Result<StoredBlob>;
  /**
   * Leases existing assets. Every digest is verified before the lease is recorded. Duplicate
   * digests are recorded once, sorted. Each call records a new lease, even for the same digests:
   * retrying after a lost result leaves an extra lease, removed by releasing it or, once its owner
   * process is gone, by collection.
   *
   * @param digests - The digests to protect.
   * @returns The {@link ReadLease}. Fails `invalid-input`, `missing-asset`, `corrupt-asset` or
   * `storage-unavailable` (also when a new lease ID collides with a stored one).
   */
  acquire(digests: unknown): Result<ReadLease>;
  /**
   * Leases digests whose bytes may be absent, so backup bytes can be installed for them.
   * Duplicate digests are recorded once, sorted. Each call records a new lease, even for the same digests:
   * retrying after a lost result leaves an extra lease, removed by releasing it or, once its owner
   * process is gone, by collection.
   *
   * @param digests - The digests to protect.
   * @returns The {@link WriteLease}. Fails `invalid-input` or `storage-unavailable`.
   */
  reserve(digests: unknown): Result<WriteLease>;
  /**
   * Checks backup bytes the way {@link WriteLease.stage} does, without storing anything or
   * needing a lease.
   *
   * @param digest - The expected digest.
   * @param base64 - The backup bytes, base64 encoded.
   * @returns Success when the bytes match. Fails `invalid-input`, `corrupt-asset`,
   * `unsupported-media` or `unsafe-media`.
   */
  verify(
    digest: unknown,
    base64: unknown,
  ): Promise<Result<void>>;
  /**
   * Deletes stored bytes that nothing references, in one storage transaction. Leases of dead
   * owner processes are deleted first; leases of live (or possibly live) owners keep their
   * digests.
   *
   * @param readReachability - Reads every digest still referenced by documents, history and
   * presets. It runs inside the transaction.
   * @returns What was removed and retained. Fails `corrupt-asset` for a malformed lease record or
   * reference list (nothing is deleted then), the reader's own failure unchanged, or
   * `storage-unavailable` (also when rolling back after a failure fails).
   */
  collectUnreferenced(readReachability: ReachabilityReader): Result<CollectionReport>;
  /**
   * Closes storage. Later calls that use storage fail with `storage-unavailable`; `verify` uses
   * no storage and still works.
   *
   * @returns Success, or the storage failure.
   */
  close(): Result<void>;
}
