import { createHash, randomUUID } from 'node:crypto';
import { digest, leaseId } from '../contract/brands.js';
import type { Digest, LeaseId } from '../contract/brands.js';
import { fail } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
import type { IdentityPort } from '../contract/ports/identity.js';
import { base64 as base64Schema } from '../contract/records/media.js';

/** The native hashing, UUID and process calls, injectable so tests can simulate failures. */
interface NativeIdentity {
  /** Returns the SHA-256 of the bytes as lowercase hex. */
  readonly hash: (bytes: Uint8Array) => string;
  /** Returns a new UUID. */
  readonly uuid: () => string;
  /** This process's ID. */
  readonly pid: number;
  /** Sends signal 0 to a process: throws when it does not exist or cannot be signalled. */
  readonly signal: (pid: number) => void;
}

/**
 * Creates the built-in {@link IdentityPort}.
 *
 * - `digest`: checks the text with the `base64` schema ("Invalid base64 encoding"), requires the
 *   canonical form (decoding then re-encoding gives the same text, "Noncanonical base64
 *   encoding"), then hashes the decoded bytes. Every failure, including a throw from hashing or a
 *   hash that is not a valid digest, is `invalid-input` at `base64`.
 * - `newLease`: a new UUID checked as a lease ID. It throws when the UUID is invalid. With the real
 *   storage, the storage transaction that called it turns the throw into a failure
 *   (`createSqliteFiles`).
 * - `ownerPid`: the process ID, read once here.
 * - `ownerAlive`: `false` only when signalling the process fails with `ESRCH` (no such process).
 *   Success, a permission error or any other failure answers `true`, so the lease is kept.
 *
 * Recovery: Assets owns lease recovery (collection deletes leases of dead owners); Authoring owns
 * retrying a request.
 *
 * @param identity - The native calls. Defaults to `node:crypto` SHA-256, `randomUUID`,
 * `process.pid` and `process.kill(pid, 0)`.
 * @returns The identity port.
 * @throws Only when reading `identity.pid` throws (it is read here, once). The default reads
 * `process.pid`, which does not throw.
 */
export function createIdentity(identity: NativeIdentity = native): IdentityPort {
  return {
    digest: (encoded) => hashBytes(encoded, identity),
    newLease: () => newLease(identity),
    ownerPid: identity.pid,
    ownerAlive: (pid) => ownerAlive(pid, identity),
  };
}

/** The real native calls. */
const native: NativeIdentity = {
  hash: (bytes) => {
    const hash = createHash('sha256');
    hash.update(bytes);
    return hash.digest('hex');
  },
  uuid: randomUUID,
  pid: process.pid,
  signal: (pid) => process.kill(pid, 0),
};

/** Hashes canonical base64; any throw becomes `invalid-input`. */
function hashBytes(
  encoded: string,
  identity: Pick<NativeIdentity, 'hash'>,
): Result<Digest> {
  try {
    return hashChecked(encoded, identity);
  } catch {
    return fail('invalid-input', 'base64', 'Canonical asset bytes could not be hashed');
  }
}

/**
 * Checks the alphabet and the canonical round trip, then hashes. One spelling per byte sequence
 * means junk or alternative encodings cannot change an asset's identity.
 */
function hashChecked(
  encoded: string,
  identity: Pick<NativeIdentity, 'hash'>,
): Result<Digest> {
  const parsed = base64Schema.safeParse(encoded);
  if (!parsed.success) {
    return fail('invalid-input', 'base64', 'Invalid base64 encoding');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) {
    return fail('invalid-input', 'base64', 'Noncanonical base64 encoding');
  }
  return { ok: true, value: digest.parse(identity.hash(bytes)) };
}

/** Only `ESRCH` proves a process is gone; every other outcome keeps the lease. */
function ownerAlive(
  pid: number,
  identity: Pick<NativeIdentity, 'signal'>,
): boolean {
  try {
    identity.signal(pid);
    return true;
  } catch (error) {
    return !isMissingProcess(error);
  }
}

/** Tells whether an error has the code `ESRCH`. The message is never parsed. */
function isMissingProcess(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return 'code' in error && error.code === 'ESRCH';
}

/** Creates a lease ID from a new UUID. Throws when the UUID is not valid. */
function newLease(identity: Pick<NativeIdentity, 'uuid'>): LeaseId {
  return leaseId.parse(identity.uuid());
}
