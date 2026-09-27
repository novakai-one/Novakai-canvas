/*
 * The service's failure vocabulary, its result envelope and the constructors that build
 * outcomes. Pure. Callers keep their draft and request ID; Authoring owns commit and receipt
 * recovery.
 */
import type { FailureSource } from './records/transport/failure-source.js';
/** Host failures name correction/recovery without exposing database or provider exception strings. */
export type ErrorCode =
  'invalid-input' | 'unauthorized' | 'not-found' | 'unavailable' | 'conflict' | 'cancelled';
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
/** Service callers retain their drafts and reconcile uncertain request receipts before any changed submission. */
export function failure<T>(
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
        'Retain the draft and request ID. Restore the named dependency or correct input; reconcile the receipt before retrying.',
    },
  };
  if (source === undefined) return rejected;
  return { ok: false, error: { ...rejected.error, source } };
}
/**
 * Authoring's failure constructor, for service roles that answer Authoring ports (planners,
 * validators, feasibility, leases, the session facade). Its codes and recovery text are
 * Authoring's.
 */
export { failure as authoringFailure } from '@novakai/canvas-authoring';
