/*
 * Collecting per-item results: every mapped value, or the first failure. Shared by the movement
 * capture and preview pipelines. Pure plumbing; no domain rules here.
 */
import type { Result } from '../../contract/errors.js';

/** The mapped values, or the first failure. */
export function mapResults<T, U>(
  items: readonly T[],
  map: (item: T) => Result<U>,
): Result<readonly U[]> {
  const mapped = items.map(map);
  const failed = mapped.find((result) => !result.ok);
  if (failed !== undefined) {
    return failed;
  }
  return { ok: true, value: mapped.flatMap((result) => (result.ok ? [result.value] : [])) };
}

/** The mapped values that exist, or the first failure. */
export function collectResults<T, U>(
  items: readonly T[],
  map: (item: T) => Result<U | undefined>,
): Result<readonly U[]> {
  const mapped = mapResults(items, map);
  if (!mapped.ok) {
    return mapped;
  }
  return { ok: true, value: mapped.value.flatMap(present) };
}

/** The value when present. */
function present<U>(value: U | undefined): readonly U[] {
  return value === undefined ? [] : [value];
}
