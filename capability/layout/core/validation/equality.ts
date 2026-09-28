/** Canonical JSON encoding makes keys/equality insensitive to object property insertion order. */
export function encoded(value: unknown): string {
  return JSON.stringify(ordered(value)) ?? 'undefined';
}
/** Arrays preserve semantic order; plain records sort their keys recursively. Inputs were snapshotted at entry. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  return record(value);
}
/** Primitive values remain exact, including null; no defaults are inserted into foreign measured content. */
function record(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, ordered(Reflect.get(value, key))]),
  );
}
/** Equality compares structure and values, not caller object identity. */
export function equal(
  a: unknown,
  b: unknown,
): boolean {
  if (a === b) return true;
  return encoded(a) === encoded(b);
}
