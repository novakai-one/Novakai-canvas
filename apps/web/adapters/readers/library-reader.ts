import type { LibraryResult, RecentVisit } from '@novakai/canvas-library';
import { z } from 'zod';
import {
  validateLibrarySnapshot,
  queryLibrary,
  collectionIdSchema,
  folderIdSchema,
} from '@novakai/canvas-library';
import { projectCollection } from '@novakai/canvas-service';
import type { Collection } from '../../contract/records/owners.js';
import type { LibraryReader } from '../../contract/records/library.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { libraryFailure } from '../../contract/foreign-failures.js';
/** Host projections are shared with service validation; Library remains the search and organisation authority. */
export function createLibraryReader(): LibraryReader {
  return {
    read: (snapshot, collections, recent) => {
      const catalogs = snapshot.records.filter(
        (record) => record.key.kind === 'catalog' && !record.deleted,
      );
      if (catalogs.length !== 1)
        return failure('invalid-library', 'Workspace requires one library catalog');
      return checked(
        validateLibrarySnapshot({
          organisation: catalogs[0]?.value,
          collections: collections.map(projectCollection),
          recent: currentVisits(collections, recent),
        }),
      );
    },
    query: (snapshot, filters, cursor) =>
      checked(
        queryLibrary({
          snapshot: { ...snapshot, recent: currentVisits(snapshot.collections, snapshot.recent) },
          request: {
            text: filters.text,
            archived: filters.archived,
            sort: filters.sort,
            kinds: ['collection'],
            limit: 50,
            ...folderFilter(filters.folder),
            ...cursorFilter(cursor),
          },
        }),
      ),
    visits: (input) => {
      const parsed = visits.safeParse(input);
      if (!parsed.success)
        return failure('invalid-visits', 'Recent collections could not be recovered');
      return { ok: true, value: parsed.data };
    },
    folderDraft: (input) => {
      const parsed = z
        .strictObject({
          id: folderIdSchema(),
          title: z.string(),
          revision: z.number().int().nonnegative(),
        })
        .safeParse(input);
      if (!parsed.success)
        return failure(
          'invalid-folder-draft',
          'The folder draft could not be recovered; stored data was retained',
        );
      return { ok: true, value: parsed.data };
    },
  };
}
const visits = z
  .array(
    z.strictObject({ collection: collectionIdSchema(), openedAt: z.number().int().nonnegative() }),
  )
  .max(10000)
  .readonly();
/** Omitted folder means all folders, matching the Library contract. */
function folderFilter(folder: string | null): Readonly<Record<string, unknown>> {
  if (folder === null) return {};
  return { folder, descendants: true };
}
/** Pagination tokens are opaque Library data; hosts never decode or synthesize offsets. */
function cursorFilter(cursor: string | null): Readonly<Record<string, unknown>> {
  if (cursor === null) return {};
  return { cursor };
}
/** Owner diagnostics remain readable while preserving the browser's stable failure envelope. */
function checked<T>(result: LibraryResult<T>): Result<T> {
  if (!result.ok)
    return failure('invalid-library', 'Library rejected this input', libraryFailure(result.error));
  return result;
}

/** Visit history is an optional browser preference. Missing IDs are excluded from this view; canonical catalog errors still reject through checked(). Stored history is not rewritten. */
function currentVisits(
  collections: readonly Pick<Collection, 'id'>[],
  recent: readonly RecentVisit[],
): readonly RecentVisit[] {
  const available = new Set(collections.map((collection) => collection.id));
  return recent.filter((visit) => available.has(visit.collection));
}
