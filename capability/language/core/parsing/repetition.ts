/*
 * Reading a run of items, such as declarations, operations, list entries, reference lists and
 * `unset` property names, with a loop rather than recursion, so a long source cannot exhaust the
 * JavaScript stack. Only nesting recurses.
 */
import type { Result } from '../../contract/errors.js';
import { protect, reject } from '../validation/outcomes.js';
import { peek, type Cursor, type Parsed } from './cursor.js';

/** The most items one run may have when the caller gives no smaller limit. */
const maxItems = 250000;

/**
 * Reads items while `continues` says so. Too many items gives `limit`; a reader that does not
 * move forward gives `provider-failure`, so the loop cannot spin forever.
 */
export function repeat<T>(
  cursor: Cursor,
  continues: (cursor: Cursor) => boolean,
  read: (cursor: Cursor) => Parsed<T>,
  maximum = maxItems,
): Result<Parsed<readonly T[]>> {
  return protect(() => collect(cursor, continues, read, maximum));
}

/** The item loop: check the limit, read, check progress, keep the value, move on. */
function collect<T>(
  initial: Cursor,
  continues: (cursor: Cursor) => boolean,
  read: (cursor: Cursor) => Parsed<T>,
  maximum: number,
): Parsed<readonly T[]> {
  let cursor = initial;
  const values: T[] = [];
  while (continues(cursor)) {
    requireCapacity(values.length, maximum, cursor);
    const parsed = read(cursor);
    checkProgress(cursor, parsed.next);
    values.push(parsed.value);
    cursor = parsed.next;
  }
  return { value: values, next: cursor };
}

/** Rejects another item once `maximum` items are read (for example 1000 patch operations). */
function requireCapacity(
  count: number,
  maximum: number,
  cursor: Cursor,
): void {
  if (count >= maximum)
    reject('limit', peek(cursor).span, `At most ${maximum} items`, 'Statement limit exceeded');
}

/** Rejects a reader that did not move the cursor forward, as a `provider-failure`. */
function checkProgress(
  before: Cursor,
  after: Cursor,
): void {
  if (after.index <= before.index)
    reject(
      'provider-failure',
      peek(before).span,
      'Advancing grammar reader',
      'Parser did not advance',
    );
}
