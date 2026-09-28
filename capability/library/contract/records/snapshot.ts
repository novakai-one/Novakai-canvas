/*
 * The Library snapshot: the organisation, the host's complete collection inventory and the recent
 * visits, all read at one consistent point. Every Library operation runs on one snapshot. The
 * record types are declared first; each schema is built by a function, so no schema object is
 * shared between calls. A snapshot these schemas reject is an `invalid-input` diagnostic; the caller
 * corrects it, and Authoring owns commit and recovery.
 */
import { z } from 'zod';
import {
  collectionIdSchema,
  sectionIdSchema,
  objectIdSchema,
  labelSchema,
  textSchema,
  nonnegativeIntegerSchema,
  MAX_RECORDS,
  recordList,
  type CollectionId,
  type ObjectId,
  type SectionId,
} from '../brands.js';
import { organisationSchema, type Organisation } from './organisation.js';

/** One section of a collection. */
export interface SectionProjection {
  readonly id: SectionId;
  /** Nonblank display title. */
  readonly title: string;
}

/** One object of a collection. An object in no section is unplaced but still searchable. */
export interface ObjectProjection {
  readonly id: ObjectId;
  /** Nonblank display label. */
  readonly label: string;
  readonly description: string;
  /** The sections the object is visible in. */
  readonly visibleIn: readonly SectionId[];
}

/**
 * The searchable view of one collection revision. It can always be rebuilt from the collection
 * and is never stored as a document of its own.
 */
export interface CollectionProjection {
  readonly id: CollectionId;
  /** The collection's authoritative revision. */
  readonly revision: number;
  /** Nonblank display title. */
  readonly title: string;
  readonly description: string;
  readonly sections: readonly SectionProjection[];
  readonly objects: readonly ObjectProjection[];
}

/**
 * One recent visit: a collection and when it was opened (a number supplied by the host; larger
 * means more recent; Library reads no clock). At most one per collection, and the collection must
 * exist. Used only for `recent` sorting and in the cursor's query key.
 */
export interface RecentVisit {
  readonly collection: CollectionId;
  readonly openedAt: number;
}

/** A snapshot that passed {@link snapshotSchema}, with defaults filled in. */
export interface LibrarySnapshot {
  readonly organisation: Organisation;
  /** The host's complete collection inventory. */
  readonly collections: readonly CollectionProjection[];
  readonly recent: readonly RecentVisit[];
}

/**
 * Builds the schema of the host's complete collection inventory: at most 10,000 projections.
 * Validation checks that every collection has exactly one organisation entry and every entry has a
 * collection.
 */
export function inventorySchema(): z.ZodType<readonly CollectionProjection[]> {
  return z.array(collectionProjectionSchema()).max(MAX_RECORDS).readonly();
}

/** Builds the snapshot schema: the organisation, the inventory and the recent visits (default none). */
export function snapshotSchema(): z.ZodType<LibrarySnapshot> {
  return z
    .strictObject({
      organisation: organisationSchema(),
      collections: inventorySchema(),
      recent: recordList(recentSchema()),
    })
    .readonly();
}

/** A section: its ID and nonblank title. */
function sectionSchema(): z.ZodType<SectionProjection> {
  return z.strictObject({ id: sectionIdSchema(), title: labelSchema() }).readonly();
}

/** An object: ID, nonblank label, description (default empty) and sections (default none). */
function objectSchema(): z.ZodType<ObjectProjection> {
  return z
    .strictObject({
      id: objectIdSchema(),
      label: labelSchema(),
      description: textSchema().default(''),
      visibleIn: recordList(sectionIdSchema()),
    })
    .readonly();
}

/** A collection projection: ID, revision, title, description, sections and objects. */
function collectionProjectionSchema(): z.ZodType<CollectionProjection> {
  return z
    .strictObject({
      id: collectionIdSchema(),
      revision: nonnegativeIntegerSchema(),
      title: labelSchema(),
      description: textSchema().default(''),
      sections: recordList(sectionSchema()),
      objects: recordList(objectSchema()),
    })
    .readonly();
}

/** A recent visit: the collection and when it was opened. */
function recentSchema(): z.ZodType<RecentVisit> {
  return z
    .strictObject({ collection: collectionIdSchema(), openedAt: nonnegativeIntegerSchema() })
    .readonly();
}
