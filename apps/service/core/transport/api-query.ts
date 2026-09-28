/*
 * Why this file exists
 *
 * A URL query can repeat a key, and that matters. For example, `?section=a&section=b` asks for two
 * sections at once, which the source route must refuse rather than quietly pick one.
 *
 * This file keeps every value sent for each key, in order, and gives routes two ways to read them:
 * all the values (to refuse a repeat), or just the last (where a repeat is harmless). It never
 * checks a value; each route does that.
 */
import type { ApiQuery } from '../../contract/records/transport/protocol.js';

/**
 * The query keys routes read: `id` (render, inspect, receipt, source), `history` (workspace),
 * `section` and `object` (source).
 */
export type QueryKey = 'id' | 'history' | 'section' | 'object';

/** What a key that wasn't sent reads as: no values. */
const NO_VALUES: readonly string[] = Object.freeze([]);

/** Reads every key in the URL's query, not only `QueryKey`, with its values in order. */
export function readApiQuery(params: URLSearchParams): ApiQuery {
  const keys = new Set(params.keys());
  const keysWithValues = [...keys].map((key) => keyWithValues(params, key));
  const query: ApiQuery = Object.freeze(Object.fromEntries(keysWithValues));
  return query;
}

/** Reads every value sent for `key`, in order, as sent; none when the key wasn't sent. */
export function readAllValues(
  query: ApiQuery,
  key: QueryKey,
): readonly string[] {
  const values = query[key];
  if (values === undefined) {
    return NO_VALUES;
  }
  return values;
}

/**
 * Reads the last value sent for `key`, as sent; `undefined` when the key wasn't sent. Use it for
 * keys where a repeat is harmless (`id`, `history`): a repeat replaces the earlier value.
 */
export function readLastValue(
  query: ApiQuery,
  key: QueryKey,
): string | undefined {
  const values = readAllValues(query, key);
  return values.at(-1);
}

/** Pairs one query key with every value sent for it, in order. */
function keyWithValues(
  params: URLSearchParams,
  key: string,
): readonly [string, readonly string[]] {
  return [key, params.getAll(key)];
}
