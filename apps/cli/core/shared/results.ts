/*
 * Why this file exists
 *
 * Many CLI steps build one thing from other steps that can each fail. `render:png` needs both a
 * collection and an output folder. If either was typed wrong, it must stop with that mistake, not
 * carry on with half a request.
 *
 * This file joins steps' `Result`s (`Success` or `Failure`, see `contract/errors.ts`): all the
 * values, or the first failure, unchanged. The failure type is `CliFailure` unless a caller names
 * another. It never makes up a value for a step that failed.
 */
import type { CliFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** Gives back every step's value, in order, or the first failure. */
export function combined<T, E = CliFailure>(
  results: readonly Result<T, E>[],
): Result<readonly T[], E> {
  const failed = results.find((item) => !item.ok);
  if (failed) return failed;
  return { ok: true, value: results.filter((item) => item.ok).map((item) => item.value) };
}

/** Makes a new value, with `make`, from a step that worked. A failed step is passed on unchanged. */
export function mapped<T, U, E = CliFailure>(
  result: Result<T, E>,
  make: (value: T) => U,
): Result<U, E> {
  if (!result.ok) return result;
  return success(make(result.value));
}

/**
 * Makes one value, with `make`, from two steps that both worked. Otherwise gives back the first
 * failure, checking `first` before `second`.
 */
export function joined<A, B, T>(
  first: Result<A>,
  second: Result<B>,
  make: (first: A, second: B) => T,
): Result<T> {
  if (!first.ok) return first;
  if (!second.ok) return second;
  return success(make(first.value, second.value));
}

/**
 * Gives back `invalid-command` for a case a `switch` should never reach. Its `never` parameter
 * makes the compiler prove every case is handled, so in practice it never runs.
 */
export function unsupported(value: never): Result<never> {
  void value;
  return failure({ code: 'invalid-command', message: 'Unsupported command' });
}
