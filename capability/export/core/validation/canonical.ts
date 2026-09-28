/*
 * Canonical JSON text for digests and byte-identical bundles: the same data always gives the
 * same text, whatever order its keys were written in.
 */

/**
 * Serializes a value as JSON with every object's keys sorted. Array order is kept, because it
 * is meaningful. Keys that look like array indexes (`"2"`, `"10"`) still come first, in numeric
 * order, because JavaScript objects always order them that way.
 *
 * Callers pass parsed, JSON-compatible records; nothing else is checked. For other input: every
 * non-array object is rebuilt from its own enumerable string keys, so prototypes and inherited
 * or non-enumerable `toJSON` methods are dropped (a `Date` becomes `{}`), but an own enumerable
 * `toJSON` function is kept and `JSON.stringify` calls it. Getters are read once each time their
 * object is reached, so an object reached twice has its getters read twice.
 *
 * @param value - The value to serialize.
 * @returns The canonical JSON text; `undefined` (despite the `string` type) when `value` itself
 * is `undefined` or a function, as with `JSON.stringify`.
 * @throws RangeError for cyclic input (the traversal recurses without limit), whatever a getter
 * or proxy throws, and whatever `JSON.stringify` throws (for example a `TypeError` for a
 * `BigInt`).
 */
export function canonical(value: unknown): string {
  return JSON.stringify(order(value));
}

/** Returns a copy of `value` with every object's keys sorted; arrays keep their order. */
function order(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(order);
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(/** The key with its value in canonical order. */ (key) => [key, order(value[key])]),
    );
  return value;
}

/** Whether `value` is a non-null object (arrays are handled before this is called). */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
}
