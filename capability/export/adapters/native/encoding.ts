/*
 * Node implementation of the Encoding port: UTF-8, base64 and SHA-256 using the platform's
 * `TextEncoder`/`TextDecoder`, `Buffer` and `node:crypto`. No file or network access.
 */
import { createHash } from 'node:crypto';
import type { Encoding } from '../../contract/ports/encoding.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Creates the native encoding. Every method is pure, so callers may repeat any call; retrying
 * an enclosing operation is the caller's decision.
 *
 * - `utf8` encodes with `TextEncoder`; a lone surrogate becomes U+FFFD.
 * - `text` decodes strictly (see {@link text}).
 * - `base64` gives standard, padded base64.
 * - `decode` accepts canonical base64 only (see {@link decode}).
 * - `hash` gives the SHA-256 digest as 64 lowercase hex characters.
 *
 * @returns A frozen `Encoding`.
 * @throws Never.
 */
export function createEncoding(): Encoding {
  return Object.freeze({
    utf8: /** The text as UTF-8 bytes, from a new `TextEncoder`. */ (value) => {
      const encoder = new TextEncoder();
      return encoder.encode(value);
    },
    text,
    base64: /** The bytes as standard base64. */ (bytes) => {
      const buffer = Buffer.from(bytes);
      return buffer.toString('base64');
    },
    decode,
    hash: /** The SHA-256 digest of the bytes as 64 lowercase hex characters. */ (bytes) => {
      const hasher = createHash('sha256');
      const updated = hasher.update(bytes);
      return updated.digest('hex');
    },
  } satisfies Encoding);
}

/**
 * Decodes UTF-8 with a fatal decoder, so corrupt DSL or manifests fail instead of turning into
 * replacement characters. A leading byte-order mark is removed, as `TextDecoder` does by
 * default.
 *
 * @returns The text, or `invalid-bundle` at `bytes` ("Malformed UTF-8").
 */
function text(bytes: Uint8Array): Result<string> {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return success(decoder.decode(bytes));
  } catch {
    return failure('invalid-bundle', 'bytes', 'Malformed UTF-8');
  }
}

/**
 * Decodes canonical base64: the standard alphabet with correct `=` padding, and unused bits
 * set to zero. The second rule is checked by re-encoding the bytes and comparing. The empty
 * string decodes to no bytes.
 *
 * @returns A new `Uint8Array` (not a `Buffer`), or `invalid-bundle` at `base64` ("Malformed
 * base64" for the alphabet or padding, "Noncanonical base64" for nonzero unused bits).
 */
function decode(value: string): Result<Uint8Array> {
  const wellFormed = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
  if (!wellFormed) return failure('invalid-bundle', 'base64', 'Malformed base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value)
    return failure('invalid-bundle', 'base64', 'Noncanonical base64');
  return success(Uint8Array.from(bytes));
}
