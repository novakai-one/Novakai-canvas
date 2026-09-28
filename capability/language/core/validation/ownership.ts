/*
 * Keeping Language's output its own: deep-freezing records Language built, and copying spans so
 * no output shares a span object with its input. Pure apart from freezing the value it is given.
 * Language owns correcting the source; Authoring owns commit recovery.
 */
import type { Position, Span } from '../../contract/records/syntax.js';

/**
 * Freezes a value Language owns, and every object inside it, children first. Used for the shared
 * vocabulary tables, `origin` and every result `protect` returns, so no caller can change them.
 */
export function deepFreeze<T>(value: T): T {
  freezeOwned(value);
  return value;
}

/**
 * A new span with the same start and end, so an output record never holds the input's span
 * object. Reads `start` (offset, line, column), then `end`.
 */
export function copySpan(span: Span): Span {
  return { start: copyPosition(span.start), end: copyPosition(span.end) };
}

/** Freezes the value and every object inside it, children first. Other values are left alone. */
function freezeOwned(value: unknown): void {
  if (value === null) return;
  if (typeof value !== 'object') return;
  Object.values(value).forEach(freezeOwned);
  Object.freeze(value);
}

/** A new position with the same offset, line and column. */
function copyPosition(position: Position): Position {
  return { offset: position.offset, line: position.line, column: position.column };
}
