import type { Digest } from '../brands.js';
import type { Result } from '../errors.js';
import type { WorkspaceState } from '../records/storage.js';

/**
 * Verifies that base64 bytes match a digest (and the media policy). Supplied by Assets; there is
 * no default that always succeeds, so production must inject a real verifier.
 */
export type VerifyBlob = (digest: Digest, base64: string) => Promise<Result<void>>;

/**
 * A lease on existing asset bytes. Every requested asset stays protected from garbage collection
 * until `release`, including after a failed backup. Assets owns recovery of a lease that is never
 * released.
 */
export interface ResourceLease {
  /** Reads one leased asset's bytes as base64. */
  read(digest: Digest): Promise<Result<string>>;
  /** Ends the lease. Always called once the backup attempt finishes. */
  release(): Promise<Result<void>>;
}

/** What `backup` needs from Assets. */
export interface BackupResources {
  /** Leases the given assets, or fails when one is already gone (retry the backup). */
  acquire(digests: readonly Digest[]): Promise<Result<ResourceLease>>;
  readonly verify: VerifyBlob;
}

/**
 * A reservation at the restore destination. Newly staged bytes stay protected from garbage
 * collection until `release`, which comes after the documents referencing them are installed.
 */
export interface RestoreLease {
  /** Stores one asset's bytes at the destination. */
  stage(
    digest: Digest,
    base64: string,
  ): Promise<Result<void>>;
  /**
   * Ends the reservation. Always called once the restore attempt finishes. If it is never called
   * (for example the process stops first), Persistence does nothing further: ending such a
   * reservation is up to the host that supplies {@link RestoreResources}.
   */
  release(): Promise<Result<void>>;
}

/** What `restore` needs from Assets. */
export interface RestoreResources {
  readonly verify: VerifyBlob;
  /** Reserves the given assets at the destination. */
  reserve(digests: readonly Digest[]): Promise<Result<RestoreLease>>;
}

/**
 * The host's validation of a restored state: Model and Library documents, cross-record rules and
 * asset references. Mandatory for restore.
 */
export type ValidateDomain = (state: WorkspaceState) => Promise<Result<void>>;
