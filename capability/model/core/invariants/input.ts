import type { Result } from '../../contract/errors.js';
import { failure, success } from './issues.js';

/** The most values one input may contain (counted as they are visited). */
const MAX_VALUES = 100_000;

/** The deepest nesting allowed; the top-level value is depth 0. */
const MAX_DEPTH = 64;

/**
 * Checks that unknown input is plain JSON data before any schema parsing, without running user
 * accessors (property descriptors are read, never property values through getters). One
 * exception: checking that an array is dense reads its `length` directly, which runs a proxy's
 * `get` trap.
 *
 * Accepted: `null`, booleans, strings, finite numbers, dense arrays with `Array.prototype`, and
 * objects whose prototype is `Object.prototype` or `null`, with only enumerable data properties
 * and no symbol keys. Values are visited depth-first from `$` (an object's last field first); the
 * first problem found stops the scan and is returned:
 * - `limit` at the value's path: more than 100,000 values visited or a value deeper than 64 levels
 *   ("Input exceeds 100000 values or nesting depth 64"), or one object with more than 100,000
 *   fields ("Input exceeds value budget");
 * - `shape` at the value's path: an accessor or non-enumerable field, a sparse array or one with
 *   extra fields, a non-plain prototype or symbol key, a cycle on the current path, or an
 *   unsupported value (`undefined`, a function, a bigint, a symbol or a non-finite number).
 *
 * The same object may appear twice in different branches (only a cycle on one path is rejected).
 * Reflection can still run proxy traps; a throw while inspecting (for example a revoked proxy) is
 * `shape` at `$`, "Input cannot be inspected as plain data". Pure data can be retried safely;
 * Authoring owns correcting rejected input, commit and crash recovery.
 *
 * @param input - The value to inspect.
 * @returns `{ ok: true, value: true }` when the input is plain JSON data, otherwise the first
 * failure. Neither is frozen.
 * @throws Never.
 */
export function inspectInput(input: unknown): Result<true> {
  try {
    return scanInput(input);
  } catch {
    return failure('shape', '$', 'Input cannot be inspected as plain data');
  }
}

/** One value waiting to be inspected. `ancestors` holds only this path's objects. */
interface InputFrame {
  /** The value. */
  readonly value: unknown;
  /** Its path, such as `$.objects.0`. */
  readonly path: string;
  /** Its nesting depth; the top-level value is 0. */
  readonly depth: number;
  /** The objects on the path from the top to this value, for cycle detection. */
  readonly ancestors: readonly object[];
}

/** The state of one inspection. Local to one call; never returned. */
interface InputScan {
  /** Values still to visit; the last one is visited next. */
  readonly pending: InputFrame[];
  /** How many values have been visited so far. */
  visited: number;
}

/**
 * Visits values until none are pending or one fails. Iterative rather than recursive, so deep
 * input cannot exhaust the call stack.
 */
function scanInput(input: unknown): Result<true> {
  const scan: InputScan = {
    pending: [{ value: input, path: '$', depth: 0, ancestors: [] }],
    visited: 0,
  };
  let inspected: Result<readonly InputFrame[]> = success([]);
  while (scan.pending.length > 0 && inspected.ok) {
    inspected = visitNext(scan);
    queueChildren(scan, inspected);
  }
  return completedInspection(inspected);
}

/** Returns the last visit's failure, or `true` (never the internal queue). */
function completedInspection(inspected: Result<readonly InputFrame[]>): Result<true> {
  if (!inspected.ok) {
    return inspected;
  }
  return success(true);
}

/** Takes the next pending value, counts it and inspects it. An empty queue is a success. */
function visitNext(scan: InputScan): Result<readonly InputFrame[]> {
  const frame = scan.pending.pop();
  if (frame === undefined) {
    return success([]);
  }
  scan.visited += 1;
  return inspectFrame(frame, scan.visited);
}

/** Queues a successful visit's children; a failed visit queues nothing. */
function queueChildren(
  scan: InputScan,
  children: Result<readonly InputFrame[]>,
): void {
  if (!children.ok) {
    return;
  }
  scan.pending.push(...children.value);
}

/** Checks the value budget and depth limit before looking at the value itself. */
function inspectFrame(
  frame: InputFrame,
  visited: number,
): Result<readonly InputFrame[]> {
  if (visited > MAX_VALUES || frame.depth > MAX_DEPTH) {
    return failure(
      'limit',
      frame.path,
      `Input exceeds ${MAX_VALUES} values or nesting depth ${MAX_DEPTH}`,
    );
  }
  return expandValue(frame);
}

/** Scalars have no children; objects are inspected further; anything else is unsupported. */
function expandValue(frame: InputFrame): Result<readonly InputFrame[]> {
  if (isJsonScalar(frame.value)) {
    return success([]);
  }
  if (isObject(frame.value)) {
    return inspectObject(frame, frame.value);
  }
  return failure('shape', frame.path, 'Unsupported JSON value');
}

/** Tells whether a value is a JSON scalar: `null`, a finite number, a string or a boolean. */
function isJsonScalar(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' || typeof value === 'boolean';
}

/** Tells whether a value is a non-null object (including arrays). */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Rejects a non-plain prototype or symbol key, then a cycle, before looking at the fields. */
function inspectObject(
  frame: InputFrame,
  value: object,
): Result<readonly InputFrame[]> {
  if (!hasPlainPrototype(value)) {
    return failure('shape', frame.path, 'Expected plain JSON data');
  }
  if (frame.ancestors.includes(value)) {
    return failure('shape', frame.path, 'Cyclic input is not JSON data');
  }
  return inspectArrayShape(frame, value);
}

/**
 * Tells whether an object has no symbol keys and a plain prototype: `Array.prototype` for an
 * array, `Object.prototype` or `null` otherwise.
 */
function hasPlainPrototype(value: object): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    return prototype === Array.prototype;
  }
  return prototype === Object.prototype || prototype === null;
}

/** Rejects an array that is sparse or has extra fields, then lists the children. */
function inspectArrayShape(
  frame: InputFrame,
  value: object,
): Result<readonly InputFrame[]> {
  if (Array.isArray(value) && !isDenseArray(value)) {
    return failure('shape', frame.path, 'Array must be dense with no extra properties');
  }
  return childFrames(frame, value);
}

/** Tells whether an array's own fields are exactly `0` to `length - 1`, in order, plus `length`. */
function isDenseArray(value: readonly unknown[]): boolean {
  const keys = Object.getOwnPropertyNames(value).filter(
    /** Skips the array's own `length`. */
    (key) => key !== 'length',
  );
  return (
    keys.length === value.length &&
    keys.every(
      /** Tells whether the field at this position is named after its index. */
      (key, index) => key === String(index),
    )
  );
}

/**
 * Lists an object's children from its property descriptors, so getters never run. Every field
 * must be an enumerable data property (an array's `length` is skipped), and there may be at most
 * 100,000 of them.
 */
function childFrames(
  frame: InputFrame,
  value: object,
): Result<readonly InputFrame[]> {
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value));
  const fields = descriptors.filter(
    /** Keeps every field except an array's `length`. */
    ([key]) => key !== 'length' || !Array.isArray(value),
  );
  const hasHiddenOrAccessor = fields.some(
    /** Tells whether the field is an accessor or not enumerable. */
    ([, descriptor]) => !isEnumerableData(descriptor),
  );
  if (hasHiddenOrAccessor) {
    return failure(
      'shape',
      frame.path,
      'Expected enumerable data properties, not accessors or hidden fields',
    );
  }
  if (fields.length > MAX_VALUES) {
    return failure('limit', frame.path, 'Input exceeds value budget');
  }
  const children = fields.map(
    /** Builds the frame for one field's value. */
    ([key, descriptor]): InputFrame => ({
      value: descriptor.value,
      path: `${frame.path}.${key}`,
      depth: frame.depth + 1,
      ancestors: [...frame.ancestors, value],
    }),
  );
  return success(children);
}

/** Tells whether a descriptor is an enumerable data property (not an accessor, not hidden). */
function isEnumerableData(descriptor: PropertyDescriptor): boolean {
  return 'value' in descriptor && descriptor.enumerable === true;
}
