/*
 * Search requests and results. The request schema is built by a function, so no schema object is
 * shared between calls. A request the schema rejects is an `invalid-input` diagnostic; the caller corrects
 * it and searches again. Library writes nothing, so a retry is always safe; Authoring owns commit
 * and recovery.
 */
import { z } from 'zod';
import { folderIdSchema, textSchema } from '../brands.js';
import type { CollectionId, FolderId, ObjectId, SectionId } from '../brands.js';
import type { ReadVersions } from '../types.js';

/**
 * The longest cursor accepted or produced (1,000,000 characters). A next cursor longer than this
 * is a `cursor-too-long` failure instead.
 */
export const MAX_CURSOR_LENGTH = 1_000_000;

/** The kinds of search hit, in the order the `order` sort ranks them. Frozen. */
export const HIT_KINDS = Object.freeze(['collection', 'section', 'object'] as const);

/** One kind of search hit. */
export type HitKind = (typeof HIT_KINDS)[number];

/** Which archived collections a search returns: none, all, or only archived ones. */
export type ArchiveMode = (typeof ARCHIVE_MODES)[number];

/** How hits are sorted: by organisation order, by title, or most recently opened first. */
export type SortMode = (typeof SORT_MODES)[number];

/** Every archive mode, in the order the schema's error message lists them. Frozen, private. */
const ARCHIVE_MODES = Object.freeze(['exclude', 'include', 'only'] as const);

/** Every sort mode, in the order the schema's error message lists them. Frozen, private. */
const SORT_MODES = Object.freeze(['order', 'title', 'recent'] as const);

/** Search criteria that passed {@link querySchema}, with defaults filled in. */
export interface QueryRequest {
  /** Every word must appear in the hit's label or description, ignoring case. */
  readonly text: string;
  /** Only entries in this folder; absent searches every folder and the root. */
  readonly folder?: FolderId | undefined;
  /** Also include the folder's subfolders. */
  readonly descendants: boolean;
  readonly archived: ArchiveMode;
  readonly sort: SortMode;
  /** Which hit kinds to return. */
  readonly kinds: readonly HitKind[];
  /** Page size, 1 to 200. */
  readonly limit: number;
  /** The `nextCursor` of the previous page. */
  readonly cursor?: string | undefined;
}

/**
 * One search hit: a collection, one of its sections, or one of its objects. `id` is in the ID
 * namespace of its `kind`, so the host can navigate to it.
 */
export type SearchHit = HitContent &
  (
    | { readonly kind: 'collection'; readonly id: CollectionId }
    | { readonly kind: 'section'; readonly id: SectionId }
    | { readonly kind: 'object'; readonly id: ObjectId }
  );

/**
 * One page of search results. `versions` are the source revisions searched. When `nextCursor` is
 * absent, this is the last page.
 */
export interface QueryPage {
  readonly hits: readonly SearchHit[];
  /** The number of matching hits across all pages. */
  readonly total: number;
  readonly versions: ReadVersions;
  readonly nextCursor?: string;
}

/**
 * Builds the schema that checks search criteria and fills in defaults:
 * - `text` (default empty): at most 10,000 characters.
 * - `folder` (optional): a folder ID.
 * - `descendants` (default false).
 * - `archived` (default `exclude`): `exclude`, `include` or `only`.
 * - `sort` (default `order`): `order`, `title` or `recent`.
 * - `kinds` (default all three): at most three hit kinds.
 * - `limit` (default 50): a whole number from 1 to 200.
 * - `cursor` (optional): a string of at most {@link MAX_CURSOR_LENGTH} characters.
 *
 * Unknown keys are rejected.
 */
export function querySchema(): z.ZodType<QueryRequest> {
  return z
    .strictObject({
      text: textSchema().default(''),
      folder: folderIdSchema().optional(),
      descendants: z.boolean().default(false),
      archived: z.enum(ARCHIVE_MODES).default('exclude'),
      sort: z.enum(SORT_MODES).default('order'),
      kinds: z.array(z.enum(HIT_KINDS)).max(3).readonly().default(allHitKinds),
      limit: z.number().int().min(1).max(200).default(50),
      cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
    })
    .readonly();
}

/**
 * What every hit shows and navigates by, copied from the collection projection (never stored in
 * the organisation).
 */
interface HitContent {
  /** The collection the hit belongs to. */
  readonly collection: CollectionId;
  readonly label: string;
  readonly description: string;
  /**
   * The sections the hit appears in: none for a collection, itself for a section, and the object's
   * `visibleIn` for an object.
   */
  readonly visibleIn: readonly SectionId[];
}

/** A new list of every hit kind: the default of `kinds`. */
function allHitKinds(): HitKind[] {
  return [...HIT_KINDS];
}
