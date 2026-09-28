/*
 * Why this file exists
 *
 * Almost any service step can go wrong: a collection might not exist, or the render worker might
 * not start. Callers must know which without reading the message. For example,
 * `GET /api/v1/render?id=missing` answers `not-found` at `missing`.
 *
 * This file gives the service one way to answer: a `Result`, either `{ ok: true, value }` (it
 * worked) or `{ ok: false, error }` (the mistake it found). It lists the service's six failure
 * codes and the helpers that build and chain Results. Parts that work for Authoring return
 * Authoring's `Result`; every code an HTTP answer can carry is in records/transport/http-codes.ts.
 *
 * It never throws. Every failure carries the same advice: keep your draft and request ID, fix the
 * cause, and check the receipt before trying again.
 */
import type { FailureSource } from './records/transport/failure-source.js';

/** Every service failure code. Callers branch on the code, never on the message. */
export const errorCodes = [
  'invalid-input', // The input is wrong; the caller fixes it.
  'unauthorized', // Wrong host, cookie or token, or a change this caller may not make.
  'not-found', // No such route, file or collection.
  'unavailable', // A part (workspace, worker, PNG encoder, server) can't answer now.
  'conflict', // The request was made for an earlier run of the server (see `Generation`).
  'cancelled', // The request was stopped, or a newer render replaced it.
] as const;

/** One service failure code; see {@link errorCodes}. */
export type ErrorCode = (typeof errorCodes)[number];

/**
 * One mistake the service found. It never carries the text of a database or library exception.
 */
export interface Diagnostic {
  readonly code: ErrorCode;
  /** Where the mistake is, for example `export.scale`, or the collection ID that was not found. */
  readonly path: string;
  /** A sentence for people. Code never branches on it. */
  readonly message: string;
  /** What the caller should do next. */
  readonly recovery: string;
  /** The capability's own failure, kept as evidence when the mistake came from one. */
  readonly source?: FailureSource | undefined;
}

/**
 * What a step answers: `{ ok: true, value }` when it worked, or `{ ok: false, error }` with the
 * mistake. `E` is the mistake's type: `Diagnostic`, unless a capability's own failure is kept.
 */
export type Result<T, E = Diagnostic> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * Builds the "it worked" answer that carries `value`. It fits any `Result`, including Authoring's.
 */
export function success<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Builds the "it found a mistake" answer: `code` at `path`, with `message`, and the code's
 * recovery advice. `source` keeps a capability's own failure as evidence.
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
 * Runs the next step when the previous one worked.
 *
 * If `result` is a mistake, it is returned unchanged and `next` is not run. So a chain of steps
 * stops at the first mistake. Works for any capability's `Result` of the same shape, including
 * Authoring's.
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  next: (value: T) => Result<U, E>,
): Result<U, E> {
  if (!result.ok) return result;
  return next(result.value);
}

/**
 * Runs `step` on each item, in order, and gives back every value, in order.
 *
 * It stops at the first mistake and returns it unchanged. Later items are not stepped, so nothing
 * more is read after a mistake.
 */
export function collect<I, T, E>(
  items: readonly I[],
  step: (item: I) => Result<T, E>,
): Result<readonly T[], E> {
  // `appendNext` passes the first failure along unchanged, so later items are not stepped.
  const appendNext = (collected: Result<readonly T[], E>, item: I): Result<readonly T[], E> =>
    andThen(collected, (values) => appendStep(values, step(item)));
  return items.reduce(appendNext, success<readonly T[]>([]));
}

/** The values with this step's value appended; the step's failure passes through unchanged. */
function appendStep<T, E>(
  values: readonly T[],
  stepped: Result<T, E>,
): Result<readonly T[], E> {
  return andThen(stepped, (value) => success([...values, value]));
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

/** Authoring's own `failure`, for service parts that must return Authoring's `Result` and codes. */
export { failure as authoringFailure } from '@novakai/canvas-authoring';
