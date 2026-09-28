import type { Result } from '../errors.js';

/**
 * Strict byte and text codecs, and SHA-256 hashing. Malformed UTF-8 or base64 is a typed failure,
 * never replacement data. Every method is side-effect free, so Export may call them any number
 * of times and there is nothing to recover. The native implementation is `createEncoding`.
 */
export interface Encoding {
  /**
   * Encodes text as UTF-8.
   *
   * @param text - Any text.
   * @returns The UTF-8 bytes.
   */
  utf8(text: string): Uint8Array;

  /**
   * Decodes UTF-8 bytes strictly.
   *
   * @param bytes - The bytes.
   * @returns The text, or `invalid-bundle` for malformed UTF-8.
   */
  text(bytes: Uint8Array): Result<string>;

  /**
   * Encodes bytes as standard, padded base64.
   *
   * @param bytes - The bytes.
   * @returns The base64 text.
   */
  base64(bytes: Uint8Array): string;

  /**
   * Decodes canonical base64 only.
   *
   * @param text - Base64 text.
   * @returns The bytes, or `invalid-bundle` for malformed or noncanonical base64.
   */
  decode(text: string): Result<Uint8Array>;

  /**
   * Hashes bytes.
   *
   * @param bytes - The bytes.
   * @returns The SHA-256 digest as 64 lowercase hex characters.
   */
  hash(bytes: Uint8Array): string;
}
