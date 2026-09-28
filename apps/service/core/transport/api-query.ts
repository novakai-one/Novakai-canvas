/*
 * The query of an API call and how a route reads it: every value per key, in order. Pure. A route
 * reads the last value of a key; the source scope reads all of them so it can refuse a repeat.
 * Nothing is written, so a refused query is the caller's to correct and resend.
 */
import type { ApiQuery } from '../../contract/records/transport/protocol.js';

/**
 * The query keys routes read: `id` (render, inspect, receipt, source), `history` (workspace),
 * `section` and `object` (source).
 */
export type QueryKey = 'id' | 'history' | 'section' | 'object';

/** Every value given for each query key, in order. Cannot fail. */
export function apiQuery(params: URLSearchParams): ApiQuery {
  const keys = [...new Set(params.keys())];
  const entries = keys.map((key) => queryEntry(params, key));
  return Object.freeze(Object.fromEntries(entries));
}

/** Every value given for `key`, in order; none when the key is absent. */
export function readAllValues(
  query: ApiQuery,
  key: QueryKey,
): readonly string[] {
  return query[key] ?? [];
}

/** The last value given for `key` (a repeat replaces an earlier one); `undefined` when absent. */
export function readLastValue(
  query: ApiQuery,
  key: QueryKey,
): string | undefined {
  return readAllValues(query, key).at(-1);
}

/** One query key with every value given for it, in order. */
function queryEntry(
  params: URLSearchParams,
  key: string,
): readonly [string, readonly string[]] {
  return [key, params.getAll(key)];
}
