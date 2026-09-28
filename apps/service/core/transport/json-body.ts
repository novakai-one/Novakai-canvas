/*
 * Why this file exists
 *
 * The change, resource and export routes all take a JSON body, and all must refuse the same bad
 * bodies. For example, a body sent as `text/plain`, or `{"version": 1` cut off, is refused.
 *
 * This file checks that `Content-Type` is `application/json`, then parses the text as JSON. It
 * never checks the JSON's shape; each route does that. The size and UTF-8 were already checked
 * when the body was read (request-body.ts).
 *
 * A refusal is `invalid-input` at `content-type` or at `body`: the part of the request that was
 * wrong (see `contract/errors.ts`).
 */
import type { HeaderValue } from '../../contract/records/transport/http.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { headerText } from './http-metadata.js';

/**
 * Which routes read the body: `change` (preview and apply) or `resource` (resources and export).
 * Only the refusal messages differ.
 */
export type JsonBodyPurpose = 'change' | 'resource';

/** The refusal messages of one route family. */
interface BodyMessages {
  readonly contentType: string;
  readonly syntax: string;
}

const messages: Readonly<Record<JsonBodyPurpose, BodyMessages>> = Object.freeze({
  change: Object.freeze({
    contentType: 'Use application/json for a mutation',
    syntax: 'Request body must be valid JSON',
  }),
  resource: Object.freeze({
    contentType: 'Use application/json',
    syntax: 'Expected valid resource JSON',
  }),
});

/**
 * Reads the body text, as sent, and answers the parsed JSON, still unchecked (the route checks it).
 * Fails with `invalid-input` at `content-type` unless one `Content-Type` header names
 * `application/json` (`charset` is ignored), and at `body` when the text isn't JSON.
 */
export function readJsonBody(
  body: string,
  contentType: HeaderValue,
  purpose: JsonBodyPurpose,
): Result<unknown> {
  if (!isJson(contentType))
    return failure('invalid-input', 'content-type', messages[purpose].contentType);
  return parsedJson(body, messages[purpose].syntax);
}

/** Whether the header, sent once, has the media type `application/json`. */
function isJson(contentType: HeaderValue): boolean {
  if (contentType.kind === 'repeated') return false;
  return mediaType(headerText(contentType)) === 'application/json';
}

/** The media type without its parameters: `application/json; charset=utf-8` → `application/json`. */
function mediaType(contentType: string): string {
  const [type = ''] = contentType.split(';');
  return type.trim();
}

/** The text as JSON. Fails with `invalid-input` at `body`, carrying `message`, on a syntax error. */
function parsedJson(
  body: string,
  message: string,
): Result<unknown> {
  try {
    const value: unknown = JSON.parse(body);
    return success(value);
  } catch {
    return failure('invalid-input', 'body', message);
  }
}
