/*
 * The organisation records: folders, entries and the organisation that holds them. The record types are
 * declared first; each schema is built by a function whose return type proves it produces that
 * record, and no schema object is shared between calls. A record these schemas reject is an
 * `invalid-input` diagnostic; the caller corrects it, and Authoring owns commit and recovery.
 */
import { z } from 'zod';
import {
  organisationIdSchema,
  folderIdSchema,
  collectionIdSchema,
  labelSchema,
  nonnegativeIntegerSchema,
  orderSchema,
  recordList,
  type OrganisationId,
  type CollectionId,
  type FolderId,
} from '../brands.js';

/** A folder. Without a parent it is at the organisation root. Folders are separate from collections. */
export interface Folder {
  readonly id: FolderId;
  /** Nonblank display title. */
  readonly title: string;
  /** The parent folder; absent at the root. */
  readonly parent?: FolderId | undefined;
  /** Sort position among siblings. */
  readonly order: number;
}

/**
 * The one entry for a live or archived collection: where it sits and how it sorts. The
 * collection's title and content stay in the collection.
 */
export interface OrganisationEntry {
  readonly collection: CollectionId;
  /** The containing folder; absent at the root. */
  readonly folder?: FolderId | undefined;
  /** Sort position. */
  readonly order: number;
  /** Archived collections are hidden from searches unless asked for. */
  readonly archived: boolean;
}

/** An organisation (schema version 1) with its folders and entries. */
export interface Organisation {
  readonly schemaVersion: 1;
  readonly id: OrganisationId;
  /** The stored revision; Authoring assigns the next one. */
  readonly revision: number;
  readonly folders: readonly Folder[];
  readonly entries: readonly OrganisationEntry[];
}

/**
 * Builds the folder schema: its ID, nonblank title, optional parent folder and sort position
 * (default 0).
 */
export function folderSchema(): z.ZodType<Folder> {
  return z
    .strictObject({
      id: folderIdSchema(),
      title: labelSchema(),
      parent: folderIdSchema().optional(),
      order: orderSchema().default(0),
    })
    .readonly();
}

/**
 * Builds the organisation entry schema: the collection, an optional folder (none means the root), the
 * sort position (default 0) and whether it is archived (default false).
 */
export function entrySchema(): z.ZodType<OrganisationEntry> {
  return z
    .strictObject({
      collection: collectionIdSchema(),
      folder: folderIdSchema().optional(),
      order: orderSchema().default(0),
      archived: z.boolean().default(false),
    })
    .readonly();
}

/**
 * Builds the organisation schema: its ID, revision, and up to 10,000 folders and 10,000 entries (each
 * defaults to empty). Unknown keys are rejected. The rules across records (unique IDs, existing
 * parents and collections, entry folders exist, one entry per collection, no parent cycles) are
 * checked by validation, not here.
 */
export function organisationSchema(): z.ZodType<Organisation> {
  return z
    .strictObject({
      schemaVersion: z.literal(1),
      id: organisationIdSchema(),
      revision: nonnegativeIntegerSchema(),
      folders: recordList(folderSchema()),
      entries: recordList(entrySchema()),
    })
    .readonly();
}
