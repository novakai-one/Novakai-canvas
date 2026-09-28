/*
 * Paging cursors: an opaque string that binds the next page's offset to the exact query, recent
 * visits and source revisions. The cursor schema is built per call and is not exported by the
 * package. Pure; the host recovers from a stale cursor by searching again without one. Authoring
 * owns commit and recovery.
 */
import { MAX_CURSOR_LENGTH, type QueryRequest } from '../../contract/records/query.js';
import type { LibrarySnapshot, RecentVisit } from '../../contract/records/snapshot.js';
import { cursorSchema, type CursorEnvelope } from '../../contract/records/cursor.js';
import type { LibraryResult } from '../../contract/errors.js';
import { failure, success } from '../shared/outcomes.js';
import { compareText } from '../shared/text.js';
import { readVersions } from '../shared/versions.js';

/**
 * The offset a request starts at: 0 without a cursor, otherwise the cursor's offset.
 *
 * A cursor may be replayed, but only with the same query and the same snapshot. It is
 * `invalid-cursor` (path `query.cursor`) when:
 * - it is not valid cursor JSON ("Cursor is malformed");
 * - the query, the recent visits or the source versions changed (organisation ID or revision, or the
 *   collection IDs and revisions, so an added or removed collection counts);
 * - its offset is past the end of the results.
 *
 * Recover by searching again without a cursor.
 */
export function cursorOffset(
  snapshot: LibrarySnapshot,
  request: QueryRequest,
  total: number,
): LibraryResult<number> {
  if (request.cursor === undefined) {
    return success(0);
  }
  const decoded = decodeCursor(request.cursor);
  if (!decoded.ok) {
    return decoded;
  }
  return validateCursor(decoded.value, cursorIdentity(snapshot, request), total);
}

/**
 * Builds the cursor for the next page: JSON of the offset and the query and version keys. A
 * cursor longer than `MAX_CURSOR_LENGTH` would be rejected by the next request, so it is a
 * `cursor-too-long` failure instead.
 */
export function nextCursor(
  snapshot: LibrarySnapshot,
  request: QueryRequest,
  offset: number,
): LibraryResult<string> {
  const cursor = JSON.stringify({ offset, ...cursorIdentity(snapshot, request) });
  if (cursor.length > MAX_CURSOR_LENGTH) {
    return failure({
      code: 'cursor-too-long',
      path: 'query.cursor',
      message: 'Snapshot identity exceeds the cursor budget; narrow the supplied inventory',
    });
  }
  return success(cursor);
}

/** The keys a cursor is bound to. */
interface CursorIdentity {
  /** JSON of the request without its cursor (page size and filters included) and recent visits. */
  readonly queryKey: string;
  /** JSON of the snapshot's source revisions. */
  readonly versionKey: string;
}

/** Builds the keys. Recent visits are sorted by collection ID, so their input order is ignored. */
function cursorIdentity(
  snapshot: LibrarySnapshot,
  request: QueryRequest,
): CursorIdentity {
  const { cursor: previousCursor, ...criteria } = request;
  // The cursor is not part of the identity; `void` marks the variable as deliberately unused.
  void previousCursor;
  const recent = snapshot.recent.toSorted(byVisitedCollection);
  return {
    queryKey: JSON.stringify({ criteria, recent }),
    versionKey: JSON.stringify(readVersions(snapshot)),
  };
}

/** Parses the cursor. Text that is not JSON is `invalid-cursor` too, not a generic read failure. */
function decodeCursor(cursor: string): LibraryResult<CursorEnvelope> {
  try {
    // The schema is built before the JSON is parsed.
    const schema = cursorSchema();
    const parsed = schema.safeParse(JSON.parse(cursor));
    if (!parsed.success) {
      return staleCursor('Cursor is malformed');
    }
    return success(parsed.data);
  } catch {
    return staleCursor('Cursor is malformed');
  }
}

/** Rejects a cursor from another query or snapshot, or whose offset is past the results. */
function validateCursor(
  cursor: CursorEnvelope,
  identity: CursorIdentity,
  total: number,
): LibraryResult<number> {
  const changed =
    cursor.queryKey !== identity.queryKey || cursor.versionKey !== identity.versionKey;
  if (changed) {
    return staleCursor('Query or source snapshot changed; start a new search');
  }
  if (cursor.offset > total) {
    return staleCursor('Cursor offset exceeds the result set');
  }
  return success(cursor.offset);
}

/** A new `invalid-cursor` failure at `query.cursor` with the given message. */
function staleCursor<T>(message: string): LibraryResult<T> {
  return failure({ code: 'invalid-cursor', path: 'query.cursor', message });
}

/** Sorts recent visits by collection ID, by code unit. */
function byVisitedCollection(
  left: RecentVisit,
  right: RecentVisit,
): number {
  return compareText(left.collection, right.collection);
}
