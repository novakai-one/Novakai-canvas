import { fail, InputFault } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';

/** The part of a zod schema `parse` uses: `safeParse` and the first issue's path and message. */
interface Parser<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
      };
}

/**
 * Wraps a value as a success. The value is not copied or frozen here; `protect` does that once
 * at the public boundary.
 *
 * @param value - The success value.
 * @returns `{ ok: true, value }`.
 * @throws Never.
 */
export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * Parses input with a schema and reports only the first issue as a failure, not as an exception.
 *
 * @param schema - The schema to parse with.
 * @param input - The untrusted input.
 * @returns The parsed data, or `invalid-input` at the first issue's dotted path (`$` and
 * "Invalid input" when the parser reports no issue).
 * @throws Whatever the schema throws (for example a throwing getter on the input); callers run
 * inside `protect`.
 */
export function parse<T>(
  schema: Parser<T>,
  input: unknown,
): Result<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return success(result.data);
  }
  const issue = result.error.issues[0];
  return fail(
    'invalid-input',
    issue?.path.map(String).join('.') ?? '$',
    issue?.message ?? 'Invalid input',
  );
}

/**
 * Copies plain JSON data, after checking it:
 * 1. Every value is `null`, a finite number, a string, a boolean, an array or a plain object
 *    (prototype `Object.prototype` or `null`), nested at most 48 levels.
 * 2. Its JSON text is at most 8 MiB (UTF-8).
 * 3. The copy is made with `structuredClone`, so it shares nothing with the input.
 *
 * The static type is kept without a cast, so a codec's generic intent stays typed.
 *
 * @param value - The data to copy.
 * @returns A deep copy.
 * @throws {@link InputFault} `invalid-input` at `$` when a check fails ("Input nesting exceeds
 * 48", "Expected plain container", "Expected finite plain JSON data", "Operation exceeds 8 MiB").
 * Other errors (a throwing getter, or a proxy `structuredClone` cannot copy) are thrown as they
 * are. Callers run inside `protect`.
 */
export function clone<T>(value: T): T {
  inspect(value, 0);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > 8 * 1024 * 1024) {
    throw new InputFault('invalid-input', '$', 'Operation exceeds 8 MiB');
  }
  return structuredClone(value);
}

/**
 * The public boundary of every Templates operation. Runs `action`, then copies (with
 * {@link clone}) and deep-freezes the result it returns, success or failure. No partial output
 * escapes.
 *
 * A throw becomes a failure, which is neither copied nor frozen: an {@link InputFault} keeps its code, path and message; anything
 * else becomes `provider-failed` at `$`, "Preset provider failed; no plan was produced".
 * Known limit: to build the failure, the thrown value is checked with `instanceof InputFault`,
 * and an `InputFault`'s `code`, `path` and `message` are read. If any of these steps throws, that
 * error escapes. Examples: a proxy whose `getPrototypeOf` trap throws (its own error escapes), a
 * revoked proxy (a `TypeError` escapes), or an `InputFault` whose `code` is a throwing getter.
 * Authoring owns correction and retry.
 *
 * @param action - The operation to run.
 * @returns A frozen copy of the action's result, or the (unfrozen) failure for a throw.
 * @throws Only an error raised while inspecting a thrown value, as described above.
 */
export function protect<T>(action: () => Result<T>): Result<T> {
  try {
    return freeze(clone(action()));
  } catch (error) {
    return caught(error);
  }
}

/**
 * The canonical JSON text of a value, used as hash input: the value is checked and copied with
 * {@link clone}, object keys are sorted by code unit, and array order is kept. Exception: JSON text
 * always lists integer-like keys (`"2"`, `"10"`) first in numeric order, before the sorted string
 * keys, because JavaScript objects enumerate them that way.
 *
 * @param value - The value to encode.
 * @returns The canonical JSON text.
 * @throws {@link InputFault} from {@link clone}, and the other errors `clone` lets through (a
 * throwing getter, a proxy `structuredClone` cannot copy); callers run inside `protect`.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(ordered(clone(value)));
}

/**
 * The first failure in a list of independent check results, or success when every check passed.
 *
 * @param results - The check results, in reporting order.
 * @returns The first failure, or `success(undefined)`.
 * @throws Never.
 */
export function firstFailure(results: readonly Result<unknown>[]): Result<void> {
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) {
    return failed;
  }
  return success(undefined);
}

/** Checks one value at `depth`; deeper than 48 levels is an `InputFault`. */
function inspect(
  value: unknown,
  depth: number,
): void {
  if (depth > 48) {
    throw new InputFault('invalid-input', '$', 'Input nesting exceeds 48');
  }
  inspectValue(value, depth);
}

/** `null` passes; objects are checked as containers; anything else must be a JSON scalar. */
function inspectValue(
  value: unknown,
  depth: number,
): void {
  if (value === null) {
    return;
  }
  if (typeof value === 'object') {
    inspectContainer(value, depth);
    return;
  }
  requireScalar(value);
}

/** True for a finite number, a string or a boolean (not undefined, symbol, bigint, NaN or a function). */
function isScalar(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' || typeof value === 'boolean';
}

/** Only arrays and plain objects are allowed (no Date or class instances); then checks each child. */
function inspectContainer(
  value: object,
  depth: number,
): void {
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new InputFault('invalid-input', '$', 'Expected plain container');
  }
  Object.values(value).forEach((child) => inspect(child, depth + 1));
}

/** Deep-freezes a value in place and returns it. Only applied to copies `protect` made. */
function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

/** Turns a throw into a failure: `InputFault` keeps its code and path; anything else is `provider-failed`. */
function caught<T>(error: unknown): Result<T> {
  if (error instanceof InputFault) {
    return fail(error.code, error.path, error.message);
  }
  return fail('provider-failed', '$', 'Preset provider failed; no plan was produced');
}

/** Returns a copy with object keys sorted at every level; array order is kept. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(ordered);
  }
  return orderedObject(value);
}

/** Builds a new object with sorted keys (via `Object.fromEntries`, so no prototype is assigned). */
function orderedRecord(value: object): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([key, item]) => [key, ordered(item)]),
  );
}

/** Rejects a non-JSON scalar before `JSON.stringify` could drop or change it. */
function requireScalar(value: unknown): void {
  if (!isScalar(value)) {
    throw new InputFault('invalid-input', '$', 'Expected finite plain JSON data');
  }
}

/** Objects get sorted keys; `null` and scalars are returned as they are. */
function orderedObject(value: unknown): unknown {
  if (value === null) {
    return value;
  }
  if (typeof value === 'object') {
    return orderedRecord(value);
  }
  return value;
}
