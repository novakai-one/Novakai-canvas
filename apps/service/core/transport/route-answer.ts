/*
 * A route's answer as the HTTP server writes it: a JSON outcome, or a file sent as bytes. Pure.
 * JSON routes answer through `answerJson`; the export route answers its file through
 * `answerFile`. A failure is always JSON: the caller corrects and resends it, and Authoring owns
 * commit and receipt recovery.
 */
import type { Result } from '../../contract/errors.js';
import type { ApiCall, RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { SentFile } from '../../contract/records/transport/server.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { ApiRouter } from '../../contract/ports/transport.js';

/** Answers one API call. */
export type RouteHandler = ApiRouter['invoke'];

/** Answers one API call with an outcome sent as JSON. */
type JsonHandler = (call: ApiCall) => Promise<HttpOutcome>;

/** The route that answers `handler`'s outcome as JSON. Fails as `handler`. */
export function answerJson(handler: JsonHandler): RouteHandler {
  return async (call) => answerOutcome(await handler(call));
}

/** The outcome, answered as JSON. Cannot fail. */
export function answerOutcome(outcome: HttpOutcome): RouteOutcome {
  return { kind: 'json', outcome };
}

/** The file, answered as bytes; its failure is answered as JSON. Cannot fail. */
export function answerFile(file: Result<SentFile>): RouteOutcome {
  if (!file.ok) return answerOutcome(file);
  return { kind: 'bytes', file: file.value };
}
