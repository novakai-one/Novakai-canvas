import { createHash } from 'node:crypto';
import { digest, timestamp } from '../contract/brands.js';
import type { Digest, Timestamp } from '../contract/brands.js';
import type { Hasher, Clock } from '../contract/ports/runtime.js';
import type { Result } from '../contract/errors.js';
import { failure } from '../contract/errors.js';

/** The hashing and clock roles built on Node.js. */
interface NodeIdentity {
  readonly hash: Hasher;
  readonly clock: Clock;
}

/**
 * Builds the hashing and clock roles that Authoring uses, backed by Node.js.
 *
 * Both native operations can be replaced, so tests can make them fail or return bad output.
 * Building the roles does no hashing and reads no clock.
 * Neither role ever throws: every failure, including bad output, is returned as a
 * `storage-unavailable` result. Authoring keeps the request identity so the caller can retry safely.
 *
 * @param hash - Turns text into a hex digest. Defaults to Node's SHA-256.
 * @param now - Returns the current time in milliseconds. Defaults to `Date.now`.
 * @returns The hashing role and the clock role.
 */
export function createNodeIdentity(
  hash: (text: string) => string = nativeHash,
  now: () => number = Date.now,
): NodeIdentity {
  const hasher: Hasher = { digest: (text) => hashText(hash, text) };
  const clock: Clock = { now: () => currentTime(now) };
  return { hash: hasher, clock };
}

/** Hashes text with Node's SHA-256. It knows nothing about Authoring; Authoring builds the canonical text. */
function nativeHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Hashes text and checks the output. A failing hasher or a malformed digest becomes a failed result.
 * `digest.safeParse` is read before the hasher runs.
 */
function hashText(
  hash: (text: string) => string,
  text: string,
): Result<Digest> {
  try {
    return checkedDigest(digest.safeParse(hash(text)));
  } catch {
    return failure('storage-unavailable', 'digest', 'Hash provider failed');
  }
}

/** Turns the digest check of the hasher output into a result. */
function checkedDigest(parsed: ReturnType<typeof digest.safeParse>): Result<Digest> {
  if (!parsed.success)
    return failure('storage-unavailable', 'digest', 'Hash provider returned an invalid digest');
  return { ok: true, value: parsed.data };
}

/**
 * Reads the clock and checks the output. A failing clock or an invalid timestamp becomes a failed result.
 * This happens before commit, so no history is partly allocated when it fails.
 * `timestamp.safeParse` is read before the clock runs.
 */
function currentTime(now: () => number): Result<Timestamp> {
  try {
    return checkedTimestamp(timestamp.safeParse(now()));
  } catch {
    return failure('storage-unavailable', 'timestamp', 'Clock provider failed');
  }
}

/** Turns the timestamp check of the clock output into a result. */
function checkedTimestamp(parsed: ReturnType<typeof timestamp.safeParse>): Result<Timestamp> {
  if (!parsed.success)
    return failure('storage-unavailable', 'timestamp', 'Clock returned an invalid timestamp');
  return { ok: true, value: parsed.data };
}
