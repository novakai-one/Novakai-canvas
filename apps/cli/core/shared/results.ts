/*
 * Combining many results into one. Pure. The first failure wins; the caller reports it and no
 * partial value is returned.
 */
import type { Result } from '../../contract/errors.js';

/** Preserve the first typed failure without inventing successful values for rejected members. */
export function combined<T>(results: readonly Result<T>[]): Result<readonly T[]> {
  const failed = results.find((item) => !item.ok);
  if (failed) return failed;
  return { ok: true, value: results.filter((item) => item.ok).map((item) => item.value) };
}
