/*
 * Why this file exists
 *
 * Almost any service step can go wrong: a collection might not exist, or the render worker might
 * not start. Callers must know which without reading the message. For example,
 * `GET /api/v1/render?id=missing` answers `not-found` at `missing`.
 *
 * This file gives the service one way to answer: a `Result`, either `{ ok: true, value }` (it
 * worked) or `{ ok: false, error }` (the mistake it found, a `Diagnostic`). It lists the six
 * failure codes and the helpers that build and chain Results. It never throws.
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
  const diagnostic = buildDiagnostic(code, path, message, source);
  return { ok: false, error: diagnostic };
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
  if (!result.ok) {
    return result;
  }
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
  const noValuesYet: Result<readonly T[], E> = success([]);
  // `appendNext` passes the first failure along unchanged, so later items are not stepped.
  return items.reduce((collected, item) => appendNext(collected, item, step), noValuesYet);
}

/** Builds one mistake with its code's recovery advice, keeping `source` only when there is one. */
function buildDiagnostic(
  code: ErrorCode,
  path: string,
  message: string,
  source: FailureSource | undefined,
): Diagnostic {
  const recovery = RECOVERY[code];
  if (source === undefined) {
    return { code, path, message, recovery };
  }
  return { code, path, message, recovery, source };
}

/** Steps the next item and appends its value, or passes an earlier failure on unchanged. */
function appendNext<I, T, E>(
  collected: Result<readonly T[], E>,
  item: I,
  step: (item: I) => Result<T, E>,
): Result<readonly T[], E> {
  if (!collected.ok) {
    return collected;
  }
  const stepped = step(item);
  if (!stepped.ok) {
    return stepped;
  }
  return success([...collected.value, stepped.value]);
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
