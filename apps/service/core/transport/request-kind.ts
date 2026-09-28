/*
 * Which part of the server answers a request: the change stream, the API or the built web app.
 * Pure; the HTTP server authenticates `events` and `api` requests before either answers. Nothing
 * is written, so a refused request is the caller's to correct and resend.
 */
import type { RequestKind } from '../../contract/records/transport/server.js';

/** The change stream route, as `METHOD path`. */
const EVENTS_ROUTE = 'GET /api/v1/events';
/** Every API path starts with this; any other path is the built web app. */
const API_PREFIX = '/api/';

/** `events` for the change stream, `api` for any other `/api/` path, `browser` otherwise. */
export function requestKind(
  method: string,
  path: string,
): RequestKind {
  if (`${method} ${path}` === EVENTS_ROUTE) return 'events';
  if (path.startsWith(API_PREFIX)) return 'api';
  return 'browser';
}
