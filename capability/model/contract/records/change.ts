import { z } from 'zod';
import { assetId, definitionId, objectId, relationshipId, sectionId, sourceId } from '../brands.js';
import { collectionSchema, assetSchema, sourceSchema } from './collection.js';
import { objectSchema } from './object.js';
import { sectionSchema } from './section.js';
import { relationshipSchema } from './relationship.js';
import { definitionSchema } from './definition.js';

/**
 * `create` (the ID must not exist yet) or `replace` (the ID must exist). One schema object,
 * shared by every record change below.
 */
const recordOperationSchema = z.enum(['create', 'replace']);

/** Creates or replaces a whole object. */
const objectChangeSchema = z
  .strictObject({ op: recordOperationSchema, target: z.literal('objects'), value: objectSchema })
  .readonly();

/** Creates or replaces a whole relationship. */
const relationshipChangeSchema = z
  .strictObject({
    op: recordOperationSchema,
    target: z.literal('relationships'),
    value: relationshipSchema,
  })
  .readonly();

/**
 * Creates or replaces a whole section. Replacing an existing section keeps the old geometry the
 * new value omits: section, appearance and group placements, and manual wire routes with their
 * locks.
 */
const sectionChangeSchema = z
  .strictObject({ op: recordOperationSchema, target: z.literal('sections'), value: sectionSchema })
  .readonly();

/** Creates or replaces a whole asset manifest entry. */
const assetChangeSchema = z
  .strictObject({ op: recordOperationSchema, target: z.literal('assets'), value: assetSchema })
  .readonly();

/** Creates or replaces a whole provenance entry. */
const sourceChangeSchema = z
  .strictObject({ op: recordOperationSchema, target: z.literal('sources'), value: sourceSchema })
  .readonly();

/** Creates or replaces a whole shared definition. */
const definitionChangeSchema = z
  .strictObject({
    op: recordOperationSchema,
    target: z.literal('definitions'),
    value: definitionSchema,
  })
  .readonly();

/**
 * Creates or replaces one complete record: `{ op, target, value }`. The target (`objects`,
 * `relationships`, `sections`, `assets`, `sources`, `definitions`) selects the value's schema;
 * omitted fields get their defaults. Exception: replacing an existing section keeps the old
 * geometry the new value omits (see the section change). Exported, shared and unfrozen.
 */
export const recordChangeSchema = z.union([
  objectChangeSchema,
  relationshipChangeSchema,
  sectionChangeSchema,
  assetChangeSchema,
  sourceChangeSchema,
  definitionChangeSchema,
]);

/**
 * Removes one record by ID: `{ op: 'remove', target, id }`. It does not cascade; a plan rejects
 * any reference left unresolved at the end of the batch.
 */
const removeChangeSchema = z.union([
  z
    .strictObject({ op: z.literal('remove'), target: z.literal('objects'), id: objectId })
    .readonly(),
  z
    .strictObject({
      op: z.literal('remove'),
      target: z.literal('relationships'),
      id: relationshipId,
    })
    .readonly(),
  z
    .strictObject({ op: z.literal('remove'), target: z.literal('sections'), id: sectionId })
    .readonly(),
  z.strictObject({ op: z.literal('remove'), target: z.literal('assets'), id: assetId }).readonly(),
  z
    .strictObject({ op: z.literal('remove'), target: z.literal('sources'), id: sourceId })
    .readonly(),
  z
    .strictObject({ op: z.literal('remove'), target: z.literal('definitions'), id: definitionId })
    .readonly(),
]);

/**
 * Replaces the whole collection: `{ op: 'replace-document', value }`. The ID and revision must
 * stay the same (`identity` otherwise). For each section whose ID matches an old section, the
 * old geometry the new value omits is kept: placements, and manual wire routes with their locks.
 */
const replaceDocumentSchema = z
  .strictObject({ op: z.literal('replace-document'), value: collectionSchema })
  .readonly();

/**
 * Deletes an object: `{ op: 'delete-object', id, cascade }`. `cascade` defaults to `false`; when
 * the object is still used, deleting it needs `cascade: true` (`delete-referenced` otherwise).
 */
const deleteObjectSchema = z
  .strictObject({
    op: z.literal('delete-object'),
    id: objectId,
    cascade: z.boolean().default(false),
  })
  .readonly();

/**
 * Hides an object in one section: `{ op: 'hide', section, object }`. The object needs an
 * ordinary appearance in that section (a group representing it is not enough; otherwise
 * `not-found`). Removes the appearance and the section's wires touching it; the object and
 * relationships themselves remain.
 */
const hideAppearanceSchema = z
  .strictObject({ op: z.literal('hide'), section: sectionId, object: objectId })
  .readonly();

/**
 * Resets one section's layout: `{ op: 'reset-layout', section }`. Clears section, appearance and
 * group placements, and manual wire points and locks.
 */
const resetLayoutSchema = z
  .strictObject({ op: z.literal('reset-layout'), section: sectionId })
  .readonly();

/**
 * Resets one wire's route: `{ op: 'reset-route', section, relationship }`. Clears that wire's
 * manual override but keeps its routing style and attachment preferences.
 */
const resetRouteSchema = z
  .strictObject({ op: z.literal('reset-route'), section: sectionId, relationship: relationshipId })
  .readonly();

/**
 * One supported change: a record create/replace, a remove, `replace-document`, `delete-object`,
 * `hide`, `reset-layout` or `reset-route`. There are no arbitrary JSON-path edits. Every variant
 * is strict (unknown fields rejected) and parses to a read-only value. Exported, shared and
 * unfrozen; `parse` throws a `ZodError`.
 */
export const changeSchema = z.union([
  recordChangeSchema,
  removeChangeSchema,
  replaceDocumentSchema,
  deleteObjectSchema,
  hideAppearanceSchema,
  resetLayoutSchema,
  resetRouteSchema,
]);

/**
 * An ordered batch of at most 1,000 changes. Validity of the result is checked after all of them
 * are applied (by `plan`). Exported, shared and unfrozen; used by Model's staging (Library has
 * its own change schema).
 */
export const changesSchema = z.array(changeSchema).max(1000).readonly();

/** One parsed change. Model plans it; Authoring decides whether to commit it. */
export type Change = z.infer<typeof changeSchema>;

/** One parsed record create or replace, with defaults filled in. */
export type RecordChange = z.infer<typeof recordChangeSchema>;
