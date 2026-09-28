/*
 * Organisation change records. Each change carries a complete record or an ID, never a partial patch
 * or a JSON path. The schema is built by a function, so no schema object is shared between calls.
 * A change these schemas reject is an `invalid-input` diagnostic; the caller corrects it, and Authoring
 * owns admission, commit and recovery.
 */
import { z } from 'zod';
import { folderIdSchema, collectionIdSchema, type CollectionId, type FolderId } from '../brands.js';
import { folderSchema, entrySchema, type OrganisationEntry, type Folder } from './organisation.js';

/** The most changes one batch may hold. */
const MAX_CHANGES = 1000;

/**
 * One organisation change:
 * - `create-folder` / `replace-folder`: a complete folder.
 * - `remove-folder`: a folder ID and `policy`: `reject` refuses a folder with contents; `rehome`
 *   moves its direct children and entries to its parent.
 * - `register` / `replace-entry`: a complete organisation entry.
 * - `unregister`: a collection ID.
 */
export type OrganisationChange =
  | { readonly op: 'create-folder'; readonly value: Folder }
  | { readonly op: 'replace-folder'; readonly value: Folder }
  | { readonly op: 'remove-folder'; readonly id: FolderId; readonly policy: RemovalPolicy }
  | { readonly op: 'register'; readonly value: OrganisationEntry }
  | { readonly op: 'replace-entry'; readonly value: OrganisationEntry }
  | { readonly op: 'unregister'; readonly collection: CollectionId };

/** What removing a folder with contents does: refuse, or move the contents to its parent. */
export type RemovalPolicy = (typeof REMOVAL_POLICIES)[number];

/** Every removal policy, in the order the schema's error message lists them. Frozen, private. */
const REMOVAL_POLICIES = Object.freeze(['reject', 'rehome'] as const);

/** The name of one kind of change. */
type ChangeOperation = OrganisationChange['op'];

/** One change of the named kind. */
export type ChangeOf<Op extends ChangeOperation> = Extract<OrganisationChange, { readonly op: Op }>;

/**
 * Builds the schema of an ordered batch of at most 1,000 changes. Planning applies
 * them in order. Each change's own checks fail at once: a missing ID is `unknown-id`, an ID
 * already present is `duplicate-id`, and `reject` on a non-empty folder is `folder-not-empty`.
 * Only the rules across records wait for the final organisation, so a later change may repair an
 * earlier one there.
 */
export function changesSchema(): z.ZodType<readonly OrganisationChange[]> {
  return z.array(changeSchema()).max(MAX_CHANGES).readonly();
}

/** Builds the schema of one change. `remove-folder`'s `policy` defaults to `reject`. */
function changeSchema(): z.ZodType<OrganisationChange> {
  return z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('create-folder'), value: folderSchema() }).readonly(),
    z.strictObject({ op: z.literal('replace-folder'), value: folderSchema() }).readonly(),
    z
      .strictObject({
        op: z.literal('remove-folder'),
        id: folderIdSchema(),
        policy: z.enum(REMOVAL_POLICIES).default('reject'),
      })
      .readonly(),
    z.strictObject({ op: z.literal('register'), value: entrySchema() }).readonly(),
    z.strictObject({ op: z.literal('replace-entry'), value: entrySchema() }).readonly(),
    z.strictObject({ op: z.literal('unregister'), collection: collectionIdSchema() }).readonly(),
  ]);
}
