/*
 * Results for the `.theme` grammar: wrapping a value or a failure, checking a brand, and combining
 * results. Pure. The first failure wins and no partial value is returned; the caller corrects the
 * theme file and reads it again.
 */
import type { Result, ThemeSourceFailure } from '../../contract/errors.js';

/** What the grammar returns: the value, or the first `.theme` failure. */
export type ThemeResult<T> = Result<T, ThemeSourceFailure>;

/** What a brand check answers: the branded value, or that the text was refused. */
type BrandAnswer<T> = { readonly success: true; readonly data: T } | { readonly success: false };

/** The part of a brand schema `checked` uses. */
interface BrandCheck<T> {
  safeParse(input: unknown): BrandAnswer<T>;
}

/** Wraps a read value. */
export function success<T>(value: T): ThemeResult<T> {
  return { ok: true, value };
}

/** Wraps a grammar failure, unchanged. */
export function failure(rejected: ThemeSourceFailure): ThemeResult<never> {
  return { ok: false, error: rejected };
}

/** `text` as the branded value `check` mints; otherwise the failure `rejectedAs`. */
export function checked<T>(
  check: BrandCheck<T>,
  text: string,
  rejectedAs: ThemeSourceFailure,
): ThemeResult<T> {
  const parsed = check.safeParse(text);
  if (!parsed.success) return failure(rejectedAs);
  return success(parsed.data);
}

/** Every value, in order, when all succeeded; otherwise the first failure. */
export function combined<T>(results: readonly ThemeResult<T>[]): ThemeResult<readonly T[]> {
  const failed = results.find((item) => !item.ok);
  if (failed) return failed;
  return success(results.filter((item) => item.ok).map((item) => item.value));
}

/** `make(value)` when `result` succeeded; otherwise its failure, unchanged. */
export function mapped<T, U>(
  result: ThemeResult<T>,
  make: (value: T) => U,
): ThemeResult<U> {
  if (!result.ok) return result;
  return success(make(result.value));
}

/** `make(first, second)` when both succeeded; otherwise `first`'s failure, then `second`'s. */
export function joined<A, B, T>(
  first: ThemeResult<A>,
  second: ThemeResult<B>,
  make: (first: A, second: B) => T,
): ThemeResult<T> {
  if (!first.ok) return first;
  if (!second.ok) return second;
  return success(make(first.value, second.value));
}
