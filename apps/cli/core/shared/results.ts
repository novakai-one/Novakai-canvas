/*
 * Combining results. Pure. The first failure wins; the caller reports it and no partial value is
 * returned. The failure type defaults to the CLI's own; render rules combine render evidence.
 */
import type { CliFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** Preserve the first typed failure without inventing successful values for rejected members. */
export function combined<T, E = CliFailure>(
  results: readonly Result<T, E>[],
): Result<readonly T[], E> {
  const failed = results.find((item) => !item.ok);
  if (failed) return failed;
  return { ok: true, value: results.filter((item) => item.ok).map((item) => item.value) };
}

/** `make(value)` when `result` succeeded; otherwise its failure, unchanged. */
export function mapped<T, U, E = CliFailure>(
  result: Result<T, E>,
  make: (value: T) => U,
): Result<U, E> {
  if (!result.ok) return result;
  return success(make(result.value));
}

/** `make(a, b)` when both succeeded; otherwise the first failure, `a` before `b`. */
export function joined<A, B, T>(
  a: Result<A>,
  b: Result<B>,
  make: (a: A, b: B) => T,
): Result<T> {
  if (!a.ok) return a;
  if (!b.ok) return b;
  return success(make(a.value, b.value));
}

/**
 * The failure for a value of no known kind: `invalid-command`. The `never` type proves every kind
 * is handled, so this is unreachable.
 */
export function unsupported(value: never): Result<never> {
  void value;
  return failure({ code: 'invalid-command', message: 'Unsupported command' });
}
