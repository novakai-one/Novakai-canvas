/*
 * Why this file exists
 *
 * One server answers three kinds of request, and each is handled differently. For example,
 * `GET /api/v1/events` stays open to stream changes, `GET /api/v1/workspace` is an API call, and
 * `GET /index.html` is one of the web app's files.
 *
 * This file sorts a request into one of the three, by its method and path alone. It never checks
 * who is calling; the server does that next.
 */
import type { RequestKind } from '../../contract/records/transport/server.js';

/** The change stream route, as `METHOD path`. */
const EVENTS_ROUTE = 'GET /api/v1/events';
/** Every API path starts with this; any other path is the built web app. */
const API_PREFIX = '/api/';

/**
 * Which part of the server answers the request: `events` for `GET /api/v1/events`, `api` for any
 * other path under `/api/`, and `browser` for everything else. `method` and `path` are the text as
 * sent. Never fails.
 */
export function requestKind(
  method: string,
  path: string,
): RequestKind {
  if (`${method} ${path}` === EVENTS_ROUTE) return 'events';
  if (path.startsWith(API_PREFIX)) return 'api';
  return 'browser';
}
