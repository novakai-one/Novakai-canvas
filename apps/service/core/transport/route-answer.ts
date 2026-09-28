/*
 * Why this file exists
 *
 * Most routes answer JSON, but the export route answers a file. For example, exporting a diagram as
 * PNG sends the image's bytes, while a refused export still sends a JSON failure.
 *
 * This file turns what a route produced into the answer the HTTP server writes: JSON, or a file's
 * bytes. A failure is always sent as JSON. It never writes to the socket itself.
 */
import type { Result } from '../../contract/errors.js';
import type { ApiCall, RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { SentFile } from '../../contract/records/transport/server.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';

/** The code that answers one API call, with JSON or a file's bytes. */
export type RouteHandler = (call: ApiCall) => Promise<RouteOutcome>;

/** The code that answers one API call with an outcome to send as JSON. */
export type JsonHandler = (call: ApiCall) => Promise<HttpOutcome>;

/** Makes a route that runs `handler` and sends its outcome as JSON. Fails as `handler` fails. */
export function jsonRoute(handler: JsonHandler): RouteHandler {
  return async (call) => answerJson(await handler(call));
}

/** The outcome, to be sent as JSON. Never fails. */
export function answerJson(outcome: HttpOutcome): RouteOutcome {
  return { kind: 'json', outcome };
}

/**
 * The file, to be sent as bytes. If making or reading the file failed, that failure is sent as
 * JSON instead. Never fails.
 */
export function answerFile(file: Result<SentFile>): RouteOutcome {
  if (!file.ok) return answerJson(file);
  return { kind: 'bytes', file: file.value };
}
