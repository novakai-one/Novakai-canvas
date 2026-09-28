import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type { Digest } from '../../contract/brands.js';
import { storedBlob } from '../../contract/records/media.js';
import type { StoredBlob } from '../../contract/records/media.js';
import type { AssetTransaction } from '../../contract/ports/storage.js';
import type { IdentityPort } from '../../contract/ports/identity.js';
import { parse, success } from '../validation/outcomes.js';
import { byteLength } from '../admission/validate.js';

/**
 * Reads a stored blob and verifies its bytes. Stale metadata never passes as a success.
 *
 * Steps, in order:
 * 1. read the blob; none is `missing-asset` at the digest ("Exact asset bytes are unavailable
 *    offline");
 * 2. check it with the `storedBlob` schema (`corrupt-asset` at the issue's path);
 * 3. hash the bytes (the hasher's failure is returned unchanged);
 * 4. the hash and the descriptor's digest must both equal the requested digest (`corrupt-asset`
 *    at the digest);
 * 5. the descriptor's `byteLength` must equal the decoded length (`corrupt-asset` at
 *    `byteLength`).
 *
 * @param storage - The transaction to read from.
 * @param digest - The digest to read.
 * @param identity - The hasher.
 * @returns The verified blob, or the first failure.
 * @throws Whatever the storage read or the hasher throws. It runs inside a storage transaction:
 * the real storage adapter turns the throw into a failure; with other storage the facade's
 * `protect` does. A `missing-asset` or `corrupt-asset` failure is recovered by restaging or
 * restoring verified original bytes.
 */
export function resolveBlob(
  storage: Pick<AssetTransaction, 'readBlob'>,
  digest: Digest,
  identity: Pick<IdentityPort, 'digest'>,
): Result<StoredBlob> {
  const raw = storage.readBlob(digest);
  if (raw === null) {
    return fail('missing-asset', digest, 'Exact asset bytes are unavailable offline');
  }
  const parsed = parse(storedBlob, raw, 'corrupt-asset');
  if (!parsed.ok) {
    return parsed;
  }
  return verifyStored(parsed.value, digest, identity);
}

/** Hashes the bytes and requires both the hash and the descriptor's digest to match. */
function verifyStored(
  blob: StoredBlob,
  expected: Digest,
  identity: Pick<IdentityPort, 'digest'>,
): Result<StoredBlob> {
  const hashed = identity.digest(blob.base64);
  if (!hashed.ok) {
    return hashed;
  }
  if (hashed.value !== expected || blob.descriptor.digest !== expected) {
    return fail('corrupt-asset', expected, 'Asset content identity mismatch');
  }
  return verifyLength(blob);
}

/** Requires the descriptor's byte length to match the decoded bytes. */
function verifyLength(blob: StoredBlob): Result<StoredBlob> {
  const actual = byteLength(blob.base64);
  if (actual !== blob.descriptor.byteLength) {
    return fail('corrupt-asset', 'byteLength', 'Stored length differs from decoded bytes');
  }
  return success(blob);
}
