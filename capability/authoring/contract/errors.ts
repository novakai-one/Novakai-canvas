import { failureSource } from './records/failure-source.js';
import type { FailureSource } from './records/failure-source.js';
import { z } from 'zod';

/**
 * The shape of every Authoring failure.
 *
 * - `code`: what kind of failure it is. Callers switch on this, never on `message`.
 * - `path` and `targets`: which input field or records caused it.
 * - `recovery`: what the caller should do next. No failure ever permits discarding a draft.
 * - `traceId`: links an unexpected failure to its request, or `null`.
 * - `source`: the collaborator's own failure, kept unchanged, when one caused this.
 */
export const diagnosticSchema = z.strictObject({
  code: z.enum([
    'invalid-input',
    'unsupported-version',
    'unknown-reference',
    'invariant-violation',
    'constraint-conflict',
    'revision-conflict',
    'request-reused',
    'missing-asset',
    'permission-denied',
    'storage-unavailable',
    'corrupt-record',
    'cancelled',
  ]),
  path: z.string(),
  targets: z.array(z.string()),
  message: z.string(),
  recovery: z.string(),
  traceId: z.string().nullable(),
  source: failureSource.optional(),
});

/** The fields of a checked diagnostic, exactly as the schema produces them. */
type DiagnosticFields = z.infer<typeof diagnosticSchema>;

/**
 * One Authoring failure. Every field is read-only, including the `targets` list; the type only
 * stops code from changing a diagnostic, and objects at run time are unchanged.
 */
export type Diagnostic = Readonly<Omit<DiagnosticFields, 'targets'>> & {
  readonly targets: readonly string[];
};

/** The closed list of Authoring failure codes. */
export type ErrorCode = Diagnostic['code'];

/**
 * The outcome of an operation: a value, or a failure. Declared here because Authoring owns it;
 * `E` defaults to Authoring's own `Diagnostic`.
 */
export type Result<T, E = Diagnostic> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** The recovery advice attached to every failure built by `failure`. */
const STANDARD_RECOVERY =
  'Retain the draft. Reconcile this request receipt before retry; re-read versions before submitting changed intent under a new request ID.';

/**
 * Builds a failed `Result` with Authoring's standard recovery advice.
 *
 * The inputs are trusted and typed; nothing is validated. `targets` is copied, and `source` is
 * kept as the same object. It does not throw.
 *
 * @param code - The failure code.
 * @param path - The input field that caused the failure.
 * @param message - A human-readable explanation.
 * @param targets - The fields or records involved. Defaults to none.
 * @param source - The collaborator's own failure, when one caused this.
 * @returns A failed result. `source` is present only when given, and `traceId` is `null`.
 */
export function failure<T>(
  code: ErrorCode,
  path: string,
  message: string,
  targets: readonly string[] = [],
  source?: FailureSource,
): Result<T> {
  const rejected: Extract<Result<T>, { readonly ok: false }> = {
    ok: false,
    error: {
      code,
      path,
      message,
      targets: [...targets],
      recovery: STANDARD_RECOVERY,
      traceId: null,
    },
  };
  if (source === undefined) return rejected;
  return { ok: false, error: { ...rejected.error, source } };
}

/**
 * A typed failure raised inside Authoring and carried to the public boundary.
 *
 * It is private to Authoring: every facade operation catches it and returns its `diagnostic`
 * as a failed `Result`, so callers never see it thrown.
 */
export class AuthoringFault extends Error {
  /**
   * Creates a fault that carries a diagnostic.
   *
   * @param diagnostic - The failure to carry. Its message becomes the error message.
   */
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}
