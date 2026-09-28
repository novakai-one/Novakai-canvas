/*
 * Splitting search text into words for discovery filters and ranking. Pure; reads no locale or
 * clock. Authoring owns commit and recovery.
 */

/** Splits search text into its words: split on runs of whitespace, empty pieces dropped. */
export function searchWords(text: string): readonly string[] {
  const pieces = text.split(/\s+/);
  return pieces.filter((piece) => piece.length > 0);
}
