/**
 * Every failure code Persistence returns. Each code carries a fixed recovery instruction (see
 * {@link fail}), which applies even when a COMMIT acknowledgement is uncertain.
 */
export type ErrorCode =
  | 'invalid-input'
  | 'unsupported-version'
  | 'revision-conflict'
  | 'request-reused'
  | 'storage-unavailable'
  | 'corrupt-record'
  | 'missing-resource'
  | 'destination-not-empty';

/** A typed storage failure: its code, where it happened, what went wrong and how to recover. */
export interface StorageError {
  readonly code: ErrorCode;
  /**
   * Dotted path into the checked value, `$` for the whole operation, or `''` for the root value.
   * A `revision-conflict` uses the record's `kind/id`. Failures from injected providers and domain
   * validation keep their own path.
   */
  readonly path: string;
  readonly message: string;
  /** The fixed recovery instruction for `code`. */
  readonly recovery: string;
}

/**
 * Persistence's own success-or-failure envelope. `E` defaults to {@link StorageError}; it is
 * declared here so Persistence does not depend on another capability's result type.
 */
export type Result<T, E = StorageError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * Builds a typed failure, adding the fixed recovery instruction for its code.
 *
 * Used by adapters and core alike. The caller that receives the failure owns the recovery it
 * names; the instruction for each code is in `recoveryByCode` below.
 *
 * @param code - The failure code.
 * @param path - Where the failure happened.
 * @param message - What went wrong.
 * @returns `{ ok: false, error: { code, path, message, recovery } }`.
 */
export function fail<T>(
  code: ErrorCode,
  path: string,
  message: string,
): Result<T> {
  const recovery = recoveryByCode[code];
  return { ok: false, error: { code, path, message, recovery } };
}

/** The recovery instruction returned with each failure code. */
const recoveryByCode: Readonly<Record<ErrorCode, string>> = {
  'invalid-input': 'Correct the submitted input.',
  'unsupported-version': 'Use a compatible reader; do not reset the database.',
  'revision-conflict': 'Re-read and prepare a new request.',
  'request-reused': 'Use a new request ID for different intent.',
  'storage-unavailable':
    'Reopen and reconcile the request receipt; for restore inspect destination before retry or activation.',
  'corrupt-record': 'Retain the original location and restore a verified backup.',
  'missing-resource': 'Restage the original bytes and retry.',
  'destination-not-empty': 'Choose a new empty restore location.',
};
