import type { Json } from '../../contract/records/storage.js';
import { reject } from './outcomes.js';

/** Size limits for one JSON value. */
export interface JsonLimits {
  /** The largest allowed size of the value's JSON text, in UTF-8 bytes. */
  readonly bytes: number;
  /** The largest allowed number of values, counting every nested value and the value itself. */
  readonly values: number;
}

/** A value copied from untrusted input, with the number of JSON values it contains. */
interface ReadValue {
  readonly value: Json;
  readonly count: number;
}

/** The deepest nesting a JSON value may have. The top-level value is at depth 0. */
const MAXIMUM_DEPTH = 64;

/** Limits for data submitted in a request. */
const requestLimits: JsonLimits = { bytes: 16 * 1024 * 1024, values: 100000 };

/**
 * Limits for stored workspaces and history. They follow Persistence's larger limit.
 * Stored data may be larger than one request, so a request limit must never be used here:
 * otherwise a history that has grown over time could no longer be read.
 */
export const storedLimits: JsonLimits = {
  bytes: 64 * 1024 * 1024,
  values: Number.MAX_SAFE_INTEGER,
};

/**
 * Makes a separate, plain copy of untrusted data and checks that it is valid JSON within limits.
 *
 * - Getters are never run: only ordinary data properties are read.
 * - Only plain objects and plain arrays are accepted. Class instances, sparse arrays and
 *   symbol-keyed properties are rejected.
 * - Numbers must be finite. `undefined`, functions, symbols and big integers are rejected,
 *   instead of being silently dropped or changed as `JSON.stringify` would do.
 * - Nesting is limited to depth 64, which also stops cyclic data.
 *
 * Authoring catches a rejection (or an error from an unreadable proxy) and keeps the caller's
 * original draft.
 *
 * @param value - The untrusted data to copy.
 * @param limits - The size limits to enforce. Defaults to the request limits.
 * @returns The copied JSON value. It shares nothing with the input.
 * @throws AuthoringFault `invalid-input` when the data is not plain JSON or breaks a limit.
 */
export function copyJson(
  value: unknown,
  limits: JsonLimits = requestLimits,
): Json {
  const copied = readValue(value, 0, limits.values).value;
  const serialized = JSON.stringify(copied);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > limits.bytes) reject('invalid-input', '$', 'JSON byte limit exceeded');
  return copied;
}

/**
 * Tells whether a value is a non-null object that is frozen.
 *
 * Authoring reuses the result of checking a frozen object. `Object.isFrozen` only checks the top
 * level, so this relies on Authoring's inputs being frozen all the way down, as `freeze` does.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a frozen object or array.
 */
export function isFrozenObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && Object.isFrozen(value);
}

/**
 * Copies one value of any type. The checks run in this order:
 * depth, `null`, string or boolean, number, object or array, and finally rejection.
 */
function readValue(
  value: unknown,
  depth: number,
  maximum: number,
): ReadValue {
  if (depth > MAXIMUM_DEPTH) reject('invalid-input', '$', 'JSON exceeds depth 64');
  if (value === null) return { value: null, count: 1 };
  return readNonNull(value, depth, maximum);
}

/** Copies a non-null value. Strings and booleans are kept exactly; no conversion method runs. */
function readNonNull(
  value: unknown,
  depth: number,
  maximum: number,
): ReadValue {
  if (typeof value === 'string' || typeof value === 'boolean') return { value, count: 1 };
  return readNumberOrContainer(value, depth, maximum);
}

/** Copies a number, or passes any other value on to be read as an object or array. */
function readNumberOrContainer(
  value: unknown,
  depth: number,
  maximum: number,
): ReadValue {
  if (typeof value === 'number') return readNumber(value);
  return readContainerOrReject(value, depth, maximum);
}

/** Copies an object or array. Every other value, such as `undefined` or a function, is rejected. */
function readContainerOrReject(
  value: unknown,
  depth: number,
  maximum: number,
): ReadValue {
  if (typeof value === 'object' && value !== null) return readContainer(value, depth, maximum);
  return reject('invalid-input', '$', 'Only JSON values are accepted');
}

/** Copies a number. `NaN` and the infinities are rejected, so they never silently become `null`. */
function readNumber(value: number): ReadValue {
  if (!Number.isFinite(value)) reject('invalid-input', '$', 'Only finite numbers are JSON');
  return { value, count: 1 };
}

/** Copies an array or an object. */
function readContainer(
  value: object,
  depth: number,
  maximum: number,
): ReadValue {
  if (Array.isArray(value)) return readArray(value, depth, maximum);
  return readObject(value, depth, maximum);
}

/** Copies a plain array. Every element must be an ordinary data property, so sparse arrays are rejected. */
function readArray(
  value: readonly unknown[],
  depth: number,
  maximum: number,
): ReadValue {
  checkPlainArray(value);
  if (Object.keys(value).length !== value.length)
    reject('invalid-input', '$', 'Sparse or decorated arrays are not JSON');

  const children = Array.from({ length: value.length }, (_unused, index) =>
    readValue(readOwnDataProperty(value, String(index)), depth + 1, maximum),
  );
  const items = children.map((child) => child.value);
  return { value: items, count: countSubtree(children, maximum) };
}

/** Copies a plain object's fields. No getter runs, and cycles stop at the depth limit. */
function readObject(
  value: object,
  depth: number,
  maximum: number,
): ReadValue {
  checkPlainObject(value);
  const entries = Object.keys(value).map((key) => ({
    key,
    read: readValue(readOwnDataProperty(value, key), depth + 1, maximum),
  }));
  const fields = Object.fromEntries(entries.map((entry) => [entry.key, entry.read.value]));
  const children = entries.map((entry) => entry.read);
  return { value: fields, count: countSubtree(children, maximum) };
}

/** Rejects array subclasses and arrays with symbol-keyed properties. */
function checkPlainArray(value: readonly unknown[]): void {
  if (Object.getPrototypeOf(value) !== Array.prototype)
    reject('invalid-input', '$', 'Only plain arrays are accepted');
  if (Object.getOwnPropertySymbols(value).length > 0)
    reject('invalid-input', '$', 'Symbol properties are not JSON');
}

/** Rejects objects whose prototype is not `Object.prototype` or `null`, and objects with symbol-keyed properties. */
function checkPlainObject(value: object): void {
  const allowedPrototypes = [Object.prototype, null];
  if (!allowedPrototypes.includes(Object.getPrototypeOf(value)))
    reject('invalid-input', '$', 'Only plain JSON objects are accepted');
  if (Object.getOwnPropertySymbols(value).length > 0)
    reject('invalid-input', '$', 'Symbol properties are not JSON');
}

/**
 * Reads a property through its descriptor, so a getter on untrusted input never runs.
 * Rejects accessor properties and missing properties.
 */
function readOwnDataProperty(
  value: object,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor))
    reject('invalid-input', key, 'Only ordinary data properties are accepted');
  return descriptor.value;
}

/**
 * Counts a container and all values inside it, and rejects the count when it is over the limit.
 * The whole subtree is counted, so many shallow branches cannot get around the limit.
 */
function countSubtree(
  children: readonly ReadValue[],
  maximum: number,
): number {
  const childCount = children.reduce((sum, child) => sum + child.count, 0);
  const count = 1 + childCount;
  if (count > maximum) reject('invalid-input', '$', 'JSON value-count limit exceeded');
  return count;
}
