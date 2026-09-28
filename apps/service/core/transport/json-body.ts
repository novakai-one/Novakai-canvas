/*
 * Why this file exists
 *
 * The change, resource and export routes all take a JSON body, and all must refuse the same bad
 * bodies. For example, a body sent as `text/plain`, or `{"version": 1` cut off, is refused.
 *
 * This file checks that `Content-Type` is `application/json`, then parses the text as JSON. It
 * never checks the JSON's shape; each route does that.
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

/** The refusal messages each route family sends. */
const REFUSAL_MESSAGES: Readonly<Record<JsonBodyPurpose, BodyMessages>> = Object.freeze({
  change: Object.freeze({
    contentType: 'Use application/json for a mutation',
    syntax: 'Request body must be valid JSON',
  }),
  resource: Object.freeze({
    contentType: 'Use application/json',
    syntax: 'Expected valid resource JSON',
  }),
});

/** The one media type a JSON body may be sent as. */
const JSON_MEDIA_TYPE = 'application/json';

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
  if (!isJsonContentType(contentType)) {
    return notJsonContentTypeFailure(purpose);
  }
  return parseJson(body, purpose);
}

/** Whether the `Content-Type` header, sent once, has the media type `application/json`. */
function isJsonContentType(contentType: HeaderValue): boolean {
  if (contentType.kind === 'repeated') {
    return false;
  }
  const sentMediaType = mediaType(headerText(contentType));
  return sentMediaType === JSON_MEDIA_TYPE;
}

/** Reads the media type without its parameters: `application/json; charset=utf-8` → `application/json`. */
function mediaType(contentType: string): string {
  const [beforeParameters = ''] = contentType.split(';');
  return beforeParameters.trim();
}

/** Parses the body text as JSON. */
function parseJson(
  body: string,
  purpose: JsonBodyPurpose,
): Result<unknown> {
  try {
    const json: unknown = JSON.parse(body);
    return success(json);
  } catch {
    return invalidJsonFailure(purpose);
  }
}

/** Makes the mistake for a body not sent as `application/json`, in the route family's words. */
function notJsonContentTypeFailure(purpose: JsonBodyPurpose): Result<never> {
  return failure('invalid-input', 'content-type', REFUSAL_MESSAGES[purpose].contentType);
}

/** Makes the mistake for body text that isn't JSON, in the route family's words. */
function invalidJsonFailure(purpose: JsonBodyPurpose): Result<never> {
  return failure('invalid-input', 'body', REFUSAL_MESSAGES[purpose].syntax);
}
