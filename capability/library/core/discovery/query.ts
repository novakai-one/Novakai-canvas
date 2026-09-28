/*
 * Searching one snapshot and returning one page. Reads no clock or locale and writes no storage or
 * index; a retry with the same input gives the same page. Authoring owns source changes, commit
 * and recovery.
 */
import {
  querySchema,
  type QueryRequest,
  type QueryPage,
  type SearchHit,
} from '../../contract/records/query.js';
import type { LibrarySnapshot } from '../../contract/records/snapshot.js';
import type { QueryInput } from '../../contract/types.js';
import type { LibraryResult } from '../../contract/errors.js';
import { failure, parse, protect, success } from '../shared/outcomes.js';
import { validateLibrarySnapshot } from '../validation/validate.js';
import { hasFolder } from '../shared/lookups.js';
import { projectHits } from './project.js';
import { filterHits } from './filters.js';
import { sortHits } from './ranking.js';
import { cursorOffset, nextCursor } from './cursor.js';
import { compareText } from '../shared/text.js';
import { searchWords } from './text.js';
import { readVersions } from '../shared/versions.js';

/**
 * Searches one snapshot and returns one page.
 *
 * Steps; the first failure stops the search and no partial page is returned:
 * 1. Read the input's `snapshot` and `request`.
 * 2. Validate the snapshot, then parse the request (defaults filled in).
 * 3. Normalize the criteria: text trimmed, lowercased and single-spaced; kinds de-duplicated and
 *    sorted. Display labels are never changed.
 * 4. Check the requested folder exists (`unknown-id`, path `query.folder`).
 * 5. Build every hit, filter, sort (see `sortHits`), then apply the cursor's offset. A bad or
 *    stale cursor is `invalid-cursor` (path `query.cursor`).
 * 6. Return up to `limit` hits, the total, the source revisions and, when more hits follow, the
 *    next cursor. A next cursor longer than `MAX_CURSOR_LENGTH` is a `cursor-too-long` failure instead.
 *
 * A throw while reading the input becomes an `invalid-input` failure at `$`.
 */
export function queryLibrary(input: QueryInput): LibraryResult<QueryPage> {
  return protect(() => prepareQuery(input));
}

/** Validates the snapshot and parses the request before any search work. */
function prepareQuery(input: QueryInput): LibraryResult<QueryPage> {
  const { snapshot, request } = input;
  const validated = validateLibrarySnapshot(snapshot);
  if (!validated.ok) {
    return validated;
  }
  const parsed = parse(querySchema(), request);
  if (!parsed.ok) {
    return parsed;
  }
  return searchSnapshot(validated.value, normalizeRequest(parsed.value));
}

/** Normalizes the search criteria only; labels and descriptions are left as they are. */
function normalizeRequest(request: QueryRequest): QueryRequest {
  const trimmed = request.text.trim();
  const lowered = trimmed.toLowerCase();
  const text = searchWords(lowered).join(' ');
  // A Set drops repeated kinds; sorting makes the order independent of the request.
  const distinctKinds = [...new Set(request.kinds)];
  const kinds = distinctKinds.toSorted(compareText);
  return { ...request, text, kinds };
}

/** Checks the folder, then filters and sorts every hit and applies the cursor's offset. */
function searchSnapshot(
  snapshot: LibrarySnapshot,
  request: QueryRequest,
): LibraryResult<QueryPage> {
  const folder = validateFolder(snapshot, request);
  if (!folder.ok) {
    return folder;
  }
  const projected = projectHits(snapshot);
  const matching = filterHits(projected, snapshot, request);
  const ordered = sortHits(matching, snapshot, request);
  const offset = cursorOffset(snapshot, request, ordered.length);
  if (!offset.ok) {
    return offset;
  }
  return completePage(snapshot, request, ordered, offset.value);
}

/** A named folder must exist; no folder means every folder. */
function validateFolder(
  snapshot: LibrarySnapshot,
  request: QueryRequest,
): LibraryResult<true> {
  if (request.folder === undefined) {
    return success(true);
  }
  if (!hasFolder(snapshot.organisation.folders, request.folder)) {
    return failure({
      code: 'unknown-id',
      path: 'query.folder',
      message: 'Search folder must exist',
    });
  }
  return success(true);
}

/**
 * Builds the page. On the last page the `nextCursor` key is left out, not set to undefined. A
 * next cursor longer than `MAX_CURSOR_LENGTH` is a `cursor-too-long` failure.
 */
function completePage(
  snapshot: LibrarySnapshot,
  request: QueryRequest,
  hits: readonly SearchHit[],
  offset: number,
): LibraryResult<QueryPage> {
  const page: QueryPage = {
    hits: hits.slice(offset, offset + request.limit),
    total: hits.length,
    versions: readVersions(snapshot),
  };
  const followingOffset = offset + page.hits.length;
  if (followingOffset >= hits.length) {
    return success(page);
  }
  const cursor = nextCursor(snapshot, request, followingOffset);
  if (!cursor.ok) {
    return cursor;
  }
  return success({ ...page, nextCursor: cursor.value });
}
