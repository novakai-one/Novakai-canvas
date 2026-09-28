import type { Json } from '../../contract/records/storage.js';
import type { Request } from '../../contract/records/request.js';
import type { Hasher } from '../../contract/ports/runtime.js';
import type { Digest } from '../../contract/brands.js';
import { digest } from '../../contract/brands.js';
import { readShape } from '../validation/input.js';
import { accepted } from '../validation/outcomes.js';

/** A JSON array or a JSON object. */
type JsonContainer = Exclude<Json, null | boolean | number | string>;

/** A JSON object. */
type JsonObject = Exclude<JsonContainer, readonly Json[]>;

/** One `[key, value]` pair of a JSON object. */
type JsonEntry = [string, Json];

/**
 * Writes a JSON value as text in one fixed form, so that equal values always produce equal text.
 *
 * - Object keys are sorted, so key order never changes the text.
 * - Array order is kept, because the order of items is part of the value.
 * - No whitespace is added.
 *
 * @param value - The JSON value to write.
 * @returns The canonical text, for example `{"a":1,"b":[2,1]}`.
 */
export function canonical(value: Json): string {
  if (isJsonScalar(value)) return JSON.stringify(value);
  return canonicalContainer(value);
}

/**
 * Computes the fingerprint of a submitted request.
 *
 * The fingerprint covers every checked submitted field except the request ID itself.
 * It never includes values that Authoring resolves later, such as asset alias pins.
 * Authoring uses it to tell a true retry (same fingerprint) from a request ID reused for different intent.
 *
 * @param request - The checked submitted request.
 * @param hash - The hashing role.
 * @returns The hasher's digest of the canonical request text.
 * @throws AuthoringFault with the hasher's own diagnostic when hashing fails.
 * @throws AuthoringFault `corrupt-record` when the hasher returns a malformed digest.
 */
export function fingerprint(
  request: Request,
  hash: Hasher,
): Digest {
  const submittedFields = withoutRequestId(request);
  const hashed = accepted(hash.digest(canonical(submittedFields)));
  return readShape(digest, hashed, 'corrupt-record');
}

/** Tells whether a JSON value is `null`, a boolean, a number or a string. */
function isJsonScalar(value: Json): value is Exclude<Json, JsonContainer> {
  return value === null || typeof value !== 'object';
}

/** Writes an array or object in canonical form. */
function canonicalContainer(value: JsonContainer): string {
  if (isJsonArray(value)) return canonicalArray(value);
  return canonicalObject(value);
}

/** Tells whether a JSON container is an array. */
function isJsonArray(value: JsonContainer): value is readonly Json[] {
  return Array.isArray(value);
}

/** Writes an array with its items in their original order. */
function canonicalArray(items: readonly Json[]): string {
  const itemTexts = items.map((item) => canonical(item));
  return `[${itemTexts.join(',')}]`;
}

/** Writes an object with its keys in sorted order. */
function canonicalObject(value: JsonObject): string {
  const sortedEntries = Object.entries(value).toSorted(compareEntryKeys);
  const entryTexts = sortedEntries.map(
    ([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`,
  );
  return `{${entryTexts.join(',')}}`;
}

/** Sort order for object entries: by key, in plain string order. */
function compareEntryKeys(
  [leftKey]: JsonEntry,
  [rightKey]: JsonEntry,
): number {
  if (leftKey < rightKey) return -1;
  return 1;
}

/** Returns the request's fields without the `request` ID field. */
function withoutRequestId(request: Request): Omit<Request, 'request'> {
  const { request: requestIdNotFingerprinted, ...submittedFields } = request;
  // Referenced once so the linter accepts the deliberately unused field.
  void requestIdNotFingerprinted;
  return submittedFields;
}
