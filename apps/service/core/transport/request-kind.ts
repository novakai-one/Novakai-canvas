/*
 * Which part of the server answers a request, and the query values an API route reads. Pure; the
 * HTTP server authenticates `events` and `api` requests before either answers. Nothing is written,
 * so a refused request is the caller's to correct and resend.
 */
import type { ApiCall } from '../../contract/records/transport/protocol.js';
import type { RequestKind } from '../../contract/records/transport/server.js';

/** The change stream route, as `METHOD path`. */
const EVENTS_ROUTE = 'GET /api/v1/events';
/** Every API path starts with this; any other path is the built web app. */
const API_PREFIX = '/api/';
/**
 * The query keys whose repeats are kept, joined with U+0000, so the source route can refuse a
 * repeated scope (core/transport/source-scope.ts). No other route reads them.
 */
const SCOPE_KEYS: ReadonlySet<string> = new Set(['section', 'object']);

/** `events` for the change stream, `api` for any other `/api/` path, `browser` otherwise. */
export function requestKind(
  method: string,
  path: string,
): RequestKind {
  if (`${method} ${path}` === EVENTS_ROUTE) return 'events';
  if (path.startsWith(API_PREFIX)) return 'api';
  return 'browser';
}

/**
 * One value per query key: the last one given, except that repeated `section` and `object` values
 * are joined with U+0000. Cannot fail.
 */
export function apiQuery(params: URLSearchParams): ApiCall['query'] {
  const values = new Map<string, string>();
  for (const [key, value] of params) values.set(key, queryValue(values.get(key), key, value));
  return Object.fromEntries(values);
}

/** The value kept for `key`: `value`, or for a scope key given before, both joined with U+0000. */
function queryValue(
  previous: string | undefined,
  key: string,
  value: string,
): string {
  if (previous === undefined || !SCOPE_KEYS.has(key)) return value;
  return `${previous}\u0000${value}`;
}
