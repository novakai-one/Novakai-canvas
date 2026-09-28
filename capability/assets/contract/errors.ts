/**
 * Every failure code Assets produces. Callers branch on the code, never on the message.
 *
 * - `invalid-input`: a schema parse failed (`parse` in core/validation/outcomes.ts); visual media
 *   has no alt text or the submitted bytes are over the limit (core/admission/validate.ts); or
 *   bytes could not be decoded or hashed (adapters/detect.ts, adapters/identity.ts).
 * - `unsupported-media`: no processor handles the media type (core/admission/stage.ts); the bytes
 *   match no supported signature (adapters/detect.ts); the bytes differ from the declared format
 *   (adapters/raster.ts, adapters/font.ts); or a font file is a collection (adapters/font.ts).
 * - `unsafe-media`: a processor's output breaks a limit or lacks dimensions or a font family
 *   (core/admission/validate.ts); a codec refused the content (adapters/raster.ts, svg.ts,
 *   font.ts); or anything was thrown while staging or checking restored bytes (`protectAsync` in
 *   core/admission/stage.ts and core/reachability/leases.ts).
 * - `missing-asset`: no bytes are stored for the digest (core/resolution/resolve.ts).
 * - `corrupt-asset`: stored bytes, metadata or a lease record are malformed or do not match their
 *   digest (core/resolution/resolve.ts, core/reachability/collect.ts, leases.ts,
 *   adapters/sqlite-files.ts, adapters/files.ts); the reachability reader returns a malformed
 *   digest list (core/reachability/collect.ts); existing bytes differ from newly normalized bytes
 *   (core/admission/stage.ts); or backup bytes do not match their digest
 *   (core/reachability/leases.ts).
 * - `lease-expired`: the lease was released or recovered, or does not cover the digest
 *   (core/reachability/leases.ts).
 * - `storage-unavailable`: storage failed or its result could not be confirmed
 *   (adapters/sqlite-files.ts); a new lease ID collided with a stored one
 *   (core/reachability/leases.ts); anything else was thrown at the public boundary (`protect` and
 *   `protectAsync` defaults); or the asset location could not be opened (contract/compose.ts).
 */
export type ErrorCode =
  | 'invalid-input'
  | 'unsupported-media'
  | 'unsafe-media'
  | 'missing-asset'
  | 'corrupt-asset'
  | 'lease-expired'
  | 'storage-unavailable';

/**
 * One failure: its code, where it happened, what went wrong and how to recover. After a storage
 * failure the caller must re-read before retrying; after a rejected media input the caller must
 * correct the input.
 */
export interface AssetError {
  /** What kind of failure this is; see {@link ErrorCode}. */
  readonly code: ErrorCode;
  /** Where the failure is: an input field such as `alt`, a digest, `lease`, or `$`. */
  readonly path: string;
  /** A human-readable explanation. Its wording is not part of the contract. */
  readonly message: string;
  /** How to recover. Every failure built with {@link fail} carries the fixed text for its code. */
  readonly recovery: string;
}

/**
 * Assets' own success-or-failure envelope. `E` defaults to {@link AssetError}; another value keeps
 * the owning capability's structured failure. It is declared here so Assets does not depend on
 * another capability's result type.
 */
export type Result<T, E = AssetError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * Builds a typed failure with the fixed recovery text for its code. Authoring owns retrying a
 * submission; Assets owns cleaning up staged files.
 *
 * @param code - The failure code. It also selects the recovery text.
 * @param path - Where the failure happened.
 * @param message - What went wrong.
 * @returns `{ ok: false, error: { code, path, message, recovery } }`.
 * @throws Never.
 */
export function fail<T>(
  code: ErrorCode,
  path: string,
  message: string,
): Result<T> {
  return { ok: false, error: { code, path, message, recovery: recovery[code] } };
}

/**
 * Thrown by the native storage adapters (adapters/files.ts, adapters/sqlite-files.ts) to carry a
 * typed failure. The storage transaction catches it and reports its code, path and message as a
 * failed {@link Result}; the message is never parsed. If rolling back then fails, the transaction
 * reports `storage-unavailable` instead.
 */
export class StorageFault extends Error {
  /**
   * Creates the fault. `code` and `path` become public read-only fields.
   *
   * @param code - The failure code the storage transaction reports.
   * @param path - Where the problem is.
   * @param message - What went wrong.
   */
  constructor(
    readonly code: ErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

/** The recovery text for each failure code. */
const recovery: Readonly<Record<ErrorCode, string>> = {
  'invalid-input': 'Correct the submitted metadata or identity.',
  'unsupported-media': 'Use a supported local image, SVG or font format.',
  'unsafe-media': 'Correct the original media; no unsafe content was admitted.',
  'missing-asset': 'Restage the original bytes and acquire them before committing a binding.',
  'corrupt-asset':
    'Retain evidence and restore verified original bytes; do not substitute content.',
  'lease-expired': 'Acquire or reserve again, then repeat verification before commit.',
  'storage-unavailable': 'Re-read blob and lease state before retry; Assets owns orphan cleanup.',
};
