/*
 * The service's failure vocabulary, its result envelope and the constructors that build
 * outcomes. Pure. Callers keep their draft and request ID; Authoring owns commit and receipt
 * recovery.
 */
import type { FailureSource } from './records/transport/failure-source.js';

/**
 * The closed list of service failure codes. Consumers branch on the code, never on the message.
 *
 * - `invalid-input`: the input is refused; the caller corrects it.
 * - `unauthorized`: the request's host, session, credential, actor or planner is refused.
 * - `not-found`: the route, file or collection does not exist.
 * - `unavailable`: the workspace, render worker, rasterizer, server or a shipped resource cannot
 *   answer now, or the request did not complete.
 * - `conflict`: the request names another transport generation.
 * - `cancelled`: the request was aborted, or a newer render replaced it.
 */
export const errorCodes = [
  'invalid-input',
  'unauthorized',
  'not-found',
  'unavailable',
  'conflict',
  'cancelled',
] as const;

/** One service failure code; see {@link errorCodes}. */
export type ErrorCode = (typeof errorCodes)[number];

/** One service failure. Host failures never expose database or provider exception text. */
export interface Diagnostic {
  readonly code: ErrorCode;
  readonly path: string;
  readonly message: string;
  readonly recovery: string;
  readonly source?: FailureSource | undefined;
}

/** Locally owned success/failure envelope; E retains the owning capability's structured failure. */
export type Result<T, E = Diagnostic> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** The success outcome carrying `value`. It fits any `Result<T, E>`, including Authoring's. */
export function success<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * The failure with `code`, at `path`, with the code's recovery text; `source` keeps the owner's
 * failure as evidence. Callers retain their drafts and reconcile uncertain request receipts
 * before any changed submission.
 */
export function failure<T>(
  code: ErrorCode,
  path: string,
  message: string,
  source?: FailureSource,
): Result<T> {
  const rejected: Extract<Result<T>, { readonly ok: false }> = {
    ok: false,
    error: { code, path, message, recovery: RECOVERY[code] },
  };
  if (source === undefined) return rejected;
  return { ok: false, error: { ...rejected.error, source } };
}

/**
 * The next step's result when `result` succeeded. A failure passes through unchanged and `next`
 * is not called, so a chain of steps stops at its first failure. Works for any capability's
 * Result of the same shape, including Authoring's.
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  next: (value: T) => Result<U, E>,
): Result<U, E> {
  if (!result.ok) return result;
  return next(result.value);
}

/**
 * Every value, in order, when every result succeeded; otherwise the first failure in order,
 * unchanged. The results are already computed, so each one was attempted.
 */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> {
  const failed = results.find(isFailure);
  if (failed) return failed;
  return success(results.filter(isSuccess).map((item) => item.value));
}

/** A failed result. */
type Failure<E> = Extract<Result<never, E>, { readonly ok: false }>;

/** A successful result. */
type Success<T> = Extract<Result<T, never>, { readonly ok: true }>;

/** Whether this result failed. */
function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
  return !result.ok;
}

/** Whether this result succeeded. */
function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
  return result.ok;
}

/** The recovery text every service failure carries: keep the draft, fix the cause, reconcile. */
const RETAIN_AND_RECONCILE =
  'Retain the draft and request ID. Restore the named dependency or correct input; reconcile the receipt before retrying.';

/** The recovery text of each code. Every row holds the same text; a row changes on its own. */
const RECOVERY: Readonly<Record<ErrorCode, string>> = Object.freeze({
  'invalid-input': RETAIN_AND_RECONCILE,
  unauthorized: RETAIN_AND_RECONCILE,
  'not-found': RETAIN_AND_RECONCILE,
  unavailable: RETAIN_AND_RECONCILE,
  conflict: RETAIN_AND_RECONCILE,
  cancelled: RETAIN_AND_RECONCILE,
});

/**
 * Authoring's failure constructor, for service roles that answer Authoring ports (planners,
 * validators, feasibility, leases, the session facade). Its codes and recovery text are
 * Authoring's.
 */
export { failure as authoringFailure } from '@novakai/canvas-authoring';
