/**
 * Deep-freezes a result in place and returns it. Every nested object and array is frozen,
 * children first, then the value itself. Primitives are returned unchanged.
 *
 * Only for results Model built itself (detached, validated JSON data): it freezes in place, so
 * never pass caller-owned objects. It visits every value again even if already frozen, so
 * freezing twice is safe. A cycle would recurse until the stack overflows; Model's results have
 * none. `validate`, `plan` and `stage` call it as their last step. Pure apart from freezing: Authoring
 * owns commit and crash recovery.
 *
 * @param value - The result to freeze.
 * @returns The same value, now deeply frozen. Typed `Readonly` at the top level; nested values
 * keep their own types (Model's records and results are already declared readonly).
 * @throws Only for input it must not be given (a cycle, or a proxy whose traps throw).
 */
export function freeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
