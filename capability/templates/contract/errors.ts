import type { FailureSource } from './records/failure-source.js';

/**
 * Every failure code Templates produces. Callers branch on the code, never on the message. A
 * provider's own failure is passed through unchanged and may carry any code.
 *
 * - `invalid-input`: a schema parse failed (`parse` in core/validation/outcomes.ts, at every
 *   input and provider-output boundary); a data bound was broken (`clone`, reported by
 *   `protect`); a payload rule failed (core/validation/catalog.ts: fonts, roles, source size,
 *   duplicate assets or themes); or `instantiate` was given a theme pin (core/expansion).
 * - `unsupported-version`: reserved; nothing produces it today.
 * - `missing-preset`: a selection names no stored version (core/discovery/select.ts), or a pin
 *   names a preset not in the catalog (core/validation/catalog.ts, used by catalog checks and
 *   expansion).
 * - `digest-mismatch`: a stored preset's content does not match its digest, or a pin's or
 *   selection's digest differs (core/validation/catalog.ts, core/discovery/select.ts); or a
 *   recipe's re-inspected payload differs from the admitted one (core/expansion/instantiate.ts).
 * - `version-exists`: admission of an existing version with different content
 *   (core/admission/plan.ts).
 * - `duplicate-preset`: the catalog lists one kind/id/version twice (core/validation/catalog.ts).
 * - `dependency-cycle`: preset dependencies (theme bases, recipe theme pins) form a loop
 *   (core/validation/catalog.ts).
 * - `provider-failed`: anything other than an `InputFault` was thrown during an operation
 *   (`protect`), or the hashing adapter returned something that is not a digest
 *   (adapters/identity.ts).
 */
export type ErrorCode =
  | 'invalid-input'
  | 'unsupported-version'
  | 'missing-preset'
  | 'digest-mismatch'
  | 'version-exists'
  | 'duplicate-preset'
  | 'dependency-cycle'
  | 'provider-failed';

/**
 * Why a `.theme` file could not be read (`readThemeSource`); the facade never returns these codes.
 * Callers branch on the code, never on the message. The first failure wins.
 * - `invalid-theme`: a line does not match the grammar, the file does not declare exactly one
 *   body, mono and strong font, the chrome is not a chrome name, or the header's @id or version
 *   is not a preset ID or version (core/theme-source/).
 * - `duplicate-token`: one token is set twice (core/theme-source/grammar.ts).
 */
export type ThemeSourceCode = 'invalid-theme' | 'duplicate-token';

/**
 * One `.theme` failure: its code, what went wrong and how to correct the file. Nothing was read or
 * staged, so the caller corrects the theme file and reads it again.
 */
export interface ThemeSourceFailure {
  /** What kind of failure this is; see {@link ThemeSourceCode}. */
  readonly code: ThemeSourceCode;
  /** A human-readable explanation. Its wording is not part of the contract. */
  readonly message: string;
  /** How to correct the theme file. */
  readonly recovery: string;
}

/** One failure: its code, where it happened, what went wrong and how to recover. */
export interface Diagnostic {
  /** What kind of failure this is; see {@link ErrorCode}. */
  readonly code: ErrorCode;
  /** Where the failure is: an input field, a preset key `kind/id/version`, a preset ID, or `$`. */
  readonly path: string;
  /** A human-readable explanation. Its wording is not part of the contract. */
  readonly message: string;
  /**
   * How to recover. Failures Templates builds with {@link fail} always carry the same instruction
   * (correct the input or provider and prepare again); a provider's own failure keeps its own
   * text.
   */
  readonly recovery: string;
  /** The owning capability's original failure, when one caused this failure. */
  readonly source?: FailureSource | undefined;
}

/**
 * Templates' own success-or-failure envelope. `E` defaults to {@link Diagnostic}; it is declared
 * here so Templates does not depend on another capability's result type.
 */
export type Result<T, E = Diagnostic> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * Builds a typed failure with the fixed recovery instruction ("Correct the input or provider,
 * then prepare again; Authoring owns commit and retry."). Plans are pure and can be prepared
 * again; Authoring owns correction, the conditional commit and retry receipts.
 *
 * @param code - The failure code.
 * @param path - Where the failure happened.
 * @param message - What went wrong.
 * @param source - The owning capability's original failure, if any. When omitted, the error has
 * no `source` key at all.
 * @returns `{ ok: false, error: { code, path, message, recovery[, source] } }`.
 * @throws Never.
 */
export function fail<T>(
  code: ErrorCode,
  path: string,
  message: string,
  source?: FailureSource,
): Result<T> {
  const rejected: Extract<Result<T>, { readonly ok: false }> = {
    ok: false,
    error: {
      code,
      path,
      message,
      recovery:
        'Correct the input or provider, then prepare again; Authoring owns commit and retry.',
    },
  };
  if (source === undefined) {
    return rejected;
  }
  return { ok: false, error: { ...rejected.error, source } };
}

/**
 * Thrown inside Templates when input data breaks a bound (nesting, size, non-plain data). The
 * public boundary (`protect`) turns it into a failure with the same code, path and message; it
 * never reaches callers as an exception.
 */
export class InputFault extends Error {
  /**
   * Creates the fault. `code` and `path` become public read-only fields.
   *
   * @param code - The failure code the boundary reports.
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
