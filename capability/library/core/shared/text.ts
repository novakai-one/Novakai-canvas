/*
 * Locale-independent string comparison used by every Library feature that sorts or pages. Pure;
 * reads no locale or clock. Authoring owns commit and recovery.
 */

/**
 * Compares two strings by UTF-16 code unit, so the order is the same on every machine and in every
 * locale.
 */
export function compareText(
  left: string,
  right: string,
): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
