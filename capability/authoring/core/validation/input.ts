import type { CheckedShape } from '../../contract/ports/decoding.js';
import type { ErrorCode } from '../../contract/errors.js';
import { requestSchema, applyOptionsSchema } from '../../contract/records/request.js';
import type { Request, ApplyOptions } from '../../contract/records/request.js';
import { copyJson, isFrozenObject } from './plain-data.js';
import type { JsonLimits } from './plain-data.js';
import { reject, freeze } from './outcomes.js';

/** One cached parse: the shape used and the frozen result it produced. */
interface ParsedEntry<T> {
  readonly shape: CheckedShape<T>;
  readonly value: T;
}

/** Maps an input object to its cached parse. */
type ParsedByInput = WeakMap<object, ParsedEntry<unknown>>;

/** Maps limits to parsed results. */
type ParsedByLimits = WeakMap<object, ParsedByInput>;

/**
 * Cache of parsed frozen input, looked up by shape, then limits, then the input object.
 * One successful parse is reused. This assumes frozen input is frozen all the way down
 * (as `freeze` does), because `Object.isFrozen` only checks the top level.
 */
const parsedByShape = new WeakMap<object, ParsedByLimits>();

/** Stands in for "no limits given" as a cache key, because a WeakMap key must be an object. */
const noLimitsKey = {};

/**
 * Copies untrusted data and checks it against a shape, without depending on a parsing framework.
 *
 * The data is first copied as plain JSON (see `copyJson`), then parsed, then deeply frozen.
 * When the input is a frozen object, a successful result is cached and reused for the same
 * shape and limits. A failed parse is never cached.
 *
 * @param shape - The shape the data must match.
 * @param value - The untrusted data.
 * @param code - The error code used when the data does not match. Defaults to `invalid-input`.
 *   Pass `corrupt-record` for data read back from storage.
 * @param limits - The JSON size limits. Defaults to the request limits.
 * @returns The parsed, deeply frozen value.
 * @throws AuthoringFault `invalid-input` when the data is not plain JSON or breaks a limit.
 * @throws AuthoringFault with `code` when the data does not match the shape.
 */
export function readShape<T>(
  shape: CheckedShape<T>,
  value: unknown,
  code: ErrorCode = 'invalid-input',
  limits?: JsonLimits,
): T {
  if (!isFrozenObject(value)) return parseShape(shape, value, code, limits);
  return parseFrozenShape(shape, value, code, limits);
}

/**
 * Copies and checks a submitted request.
 *
 * The request is copied before anything is awaited, so later changes by the caller cannot
 * affect it. The protocol version is checked before the full shape, so an unsupported version
 * gets its own error code instead of a general shape error.
 *
 * @param input - The untrusted submitted request.
 * @returns The checked, deeply frozen request.
 * @throws AuthoringFault `invalid-input` when the request is not plain JSON, breaks a limit, or has the wrong shape.
 * @throws AuthoringFault `unsupported-version` when the request names a protocol version other than 1.
 */
export function readRequest(input: unknown): Request {
  const copied = copyJson(input);
  checkVersion(copied);
  return readShape(requestSchema, copied);
}

/**
 * Copies and checks the options for applying a request.
 *
 * An omitted `candidateHash` stays absent; it never becomes an explicit `undefined` field.
 * Authoring recomputes every candidate either way.
 *
 * @param input - The untrusted options.
 * @returns The checked options.
 * @throws AuthoringFault `invalid-input` when the options are not plain JSON or have the wrong shape.
 */
export function readOptions(input: unknown): ApplyOptions {
  const options = readShape(applyOptionsSchema, input);
  if (options.candidateHash === undefined) return {};
  return { candidateHash: options.candidateHash };
}

/** Parses frozen input, reusing an earlier successful result for the same shape and limits. */
function parseFrozenShape<T>(
  shape: CheckedShape<T>,
  value: object,
  code: ErrorCode,
  limits: JsonLimits | undefined,
): T {
  const cache = parsedCache(shape, limits);
  const entry = cache.get(value);
  if (entry !== undefined && isEntryFor(entry, shape)) return entry.value;

  const result = parseShape(shape, value, code, limits);
  cache.set(value, { shape, value: result });
  return result;
}

/**
 * Tells whether a cached parse was made with this shape, so its value has the shape's type.
 * The cache is already split by shape, so this is always true; it lets the compiler prove the type.
 */
function isEntryFor<T>(
  entry: ParsedEntry<unknown>,
  shape: CheckedShape<T>,
): entry is ParsedEntry<T> {
  return entry.shape === shape;
}

/** Copies the data, parses it against the shape and deeply freezes the result. */
function parseShape<T>(
  shape: CheckedShape<T>,
  value: unknown,
  code: ErrorCode,
  limits: JsonLimits | undefined,
): T {
  const parsed = shape.safeParse(copyJson(value, limits));
  if (!parsed.success) reject(code, '$', 'Data does not match the required authoring contract');
  return freeze(parsed.data);
}

/** Returns the cache for one shape and one set of limits, creating it when needed. */
function parsedCache(
  shape: object,
  limits: object | undefined,
): ParsedByInput {
  const byLimits = childMap(parsedByShape, shape);
  const limitsKey = limits ?? noLimitsKey;
  return childMap(byLimits, limitsKey);
}

/** Returns the inner map stored under a key, creating and storing an empty one when needed. */
function childMap<V>(
  parent: WeakMap<object, WeakMap<object, V>>,
  key: object,
): WeakMap<object, V> {
  const existing = parent.get(key);
  if (existing !== undefined) return existing;

  const created = new WeakMap<object, V>();
  parent.set(key, created);
  return created;
}

/** Rejects an unsupported protocol version. Values that are not objects are left to the shape check. */
function checkVersion(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  checkObjectVersion(value);
}

/**
 * Rejects an object whose `version` field is present and is not `1`.
 * The data is already a plain copy, so reading the field cannot run a getter.
 */
function checkObjectVersion(value: object): void {
  if (!('version' in value)) return;
  if (value.version !== 1)
    reject('unsupported-version', 'version', 'Only authoring protocol version 1 is supported');
}
