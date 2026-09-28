/** Deterministic JSON keys preserve arrays and distinguish scalar values; facade owns unreadable-input recovery. */
export function canonical(value: unknown): string {
  return JSON.stringify(ordered(value));
}
/** Rebuild input data without altering the caller; semantic list order is retained. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  return orderedRecord(value);
}
/** Object keys are sorted at every depth; scalar values pass through unchanged. */
function orderedRecord(value: unknown): unknown {
  if (value === null) return value;
  if (typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([key, item]) => [key, ordered(item)]),
  );
}

/** Code-point key ordering is independent of OS locale/ICU versions, keeping pinned identities reproducible. */
function compareKeys(
  a: string,
  b: string,
): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
