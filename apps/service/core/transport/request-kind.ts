/*
 * Which part of the server answers a request, the query of an API call and how a route reads it.
 * Pure; the HTTP server authenticates `events` and `api` requests before either answers. Nothing
 * is written, so a refused request is the caller's to correct and resend.
 */
import type { ApiQuery } from '../../contract/records/transport/protocol.js';
import type { RequestKind } from '../../contract/records/transport/server.js';

/** The change stream route, as `METHOD path`. */
const EVENTS_ROUTE = 'GET /api/v1/events';
/** Every API path starts with this; any other path is the built web app. */
const API_PREFIX = '/api/';

/**
 * The query keys routes read: `id` (render, inspect, receipt, source), `history` (workspace),
 * `section` and `object` (source).
 */
export type QueryKey = 'id' | 'history' | 'section' | 'object';

/** `events` for the change stream, `api` for any other `/api/` path, `browser` otherwise. */
export function requestKind(
  method: string,
  path: string,
): RequestKind {
  if (`${method} ${path}` === EVENTS_ROUTE) return 'events';
  if (path.startsWith(API_PREFIX)) return 'api';
  return 'browser';
}

/** Every value given for each query key, in order. Cannot fail. */
export function apiQuery(params: URLSearchParams): ApiQuery {
  const keys = new Set(params.keys());
  return Object.freeze(Object.fromEntries([...keys].map((key) => [key, params.getAll(key)])));
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
