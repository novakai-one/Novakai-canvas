/*
 * Source coordinates. The lexer finds where each line starts once, then turns character offsets
 * into positions (line and column, from 1) and spans. Offsets and columns count UTF-16 code
 * units. No side effects. Language owns correcting the source; Authoring owns commit recovery.
 */
import type { Position, Span } from '../../contract/records/syntax.js';

/** Finds where every line starts. Only `\n` ends a line; a lone `\r` or U+2028 does not. */
export function lineStarts(source: string): readonly number[] {
  return [0, ...Array.from(source.matchAll(/\n/g), (match) => match.index + 1)];
}

/**
 * Turns an offset into a position. The offset is not range-checked: a negative offset gives a
 * column below 1 on line 1, and an offset past the end lands on the last line.
 */
export function position(
  starts: readonly number[],
  offset: number,
): Position {
  const line = lineIndex(starts, offset, 0, starts.length);
  return { offset, line: line + 1, column: offset - (starts[line] ?? 0) + 1 };
}

/** Turns two offsets into a span. */
export function sourceSpan(
  starts: readonly number[],
  start: number,
  end: number,
): Span {
  return { start: position(starts, start), end: position(starts, end) };
}

/**
 * The index of the line holding `offset`: a binary search between `lower` (inclusive) and
 * `upper` (exclusive). It recurses once per halving, so the depth grows with log(line count).
 */
function lineIndex(
  starts: readonly number[],
  offset: number,
  lower: number,
  upper: number,
): number {
  if (lower + 1 >= upper) return lower;
  const middle = Math.floor((lower + upper) / 2);
  const precedes = (starts[middle] ?? Infinity) <= offset;
  if (precedes) return lineIndex(starts, offset, middle, upper);
  return lineIndex(starts, offset, lower, middle);
}
