/*
 * The JSON body policy of the mutation, resource and export routes: `application/json` only, then
 * a JSON parse. Pure. The body reader (request-body.ts) already caps a body at 24 MiB and rejects
 * invalid UTF-8, so no route counts bytes again. A refused body is the caller's to correct and
 * resend.
 */
import type { HeaderValue } from '../../contract/records/transport/http.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { readHeader } from './request-head.js';

/**
 * Which route family reads the body: `mutation` for the Authoring routes, `resource` for the
 * resource and export routes. Each family keeps its own refusal messages.
 */
export type JsonBodyPurpose = 'mutation' | 'resource';

/** The refusal messages of one route family. */
interface BodyMessages {
  readonly contentType: string;
  readonly syntax: string;
}

const messages: Readonly<Record<JsonBodyPurpose, BodyMessages>> = Object.freeze({
  mutation: Object.freeze({
    contentType: 'Use application/json for a mutation',
    syntax: 'Request body must be valid JSON',
  }),
  resource: Object.freeze({
    contentType: 'Use application/json',
    syntax: 'Expected valid resource JSON',
  }),
});

/**
 * The body parsed as JSON. Fails with `invalid-input` at `content-type` unless one Content-Type
 * header names `application/json` (parameters such as `charset` are ignored), and at `body` when
 * the text is not JSON.
 */
export function jsonBody(
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
  const text = readHeader(contentType);
  if (text === undefined) return false;
  return mediaType(text) === 'application/json';
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
