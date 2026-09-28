import { z } from 'zod';
import { assetId, collectionId, digest, label, sourceId } from '../brands.js';
import { definitionSchema } from './definition.js';
import { objectSchema } from './object.js';
import { relationshipSchema } from './relationship.js';
import { sectionSchema } from './section.js';
import { layoutSchema } from './layout.js';

/**
 * An asset manifest entry: `id`, content `digest`, `mediaType`, nonblank `alt` text, and
 * optional `license` and `attribution`. Model stores no bytes and does not interpret licenses.
 */
export const assetSchema = z
  .strictObject({
    id: assetId,
    digest,
    mediaType: label,
    alt: label,
    license: z.string().optional(),
    attribution: z.string().optional(),
  })
  .readonly();

/**
 * A provenance claim that objects and relationships refer to by ID: a nonblank `uri`, optional
 * `revision`, `location` and `description`, and a `status` (`asserted`, `source-backed` or
 * `unverified`). Model does not check the URI.
 */
export const sourceSchema = z
  .strictObject({
    id: sourceId,
    uri: label,
    revision: z.string().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['asserted', 'source-backed', 'unverified']),
  })
  .readonly();

/**
 * The pinned theme: `id`, `version`, `digest`, and at least one role name. Group roles used in
 * sections must be one of these roles.
 */
export const themeSchema = z
  .strictObject({ id: label, version: label, digest, roles: z.array(label).min(1).readonly() })
  .readonly();

/**
 * The collection: schema version 1, `id`, `revision` (a whole number, 0 or more), nonblank
 * `title`, optional `description`, `theme`, `arrangement`, and the record lists `sections`,
 * `objects`, `relationships`, `sources`, `definitions` and `assets` (each defaults to empty).
 * Strict: unknown fields are rejected, except that an empty `changes` list is dropped first (see
 * `dropEmptyChanges`). Parsing builds a new object; cross-record rules are checked by Model core.
 *
 * Exported, shared and unfrozen; `parse` throws a `ZodError`. Use `validate` (api.ts) instead
 * for untrusted input.
 */
export const collectionSchema = z.preprocess(
  dropEmptyChanges,
  z
    .strictObject({
      schemaVersion: z.literal(1),
      id: collectionId,
      revision: z.number().int().nonnegative(),
      title: label,
      description: z.string().optional(),
      theme: themeSchema,
      sections: z.array(sectionSchema).readonly().default([]),
      objects: z.array(objectSchema).readonly().default([]),
      relationships: z.array(relationshipSchema).readonly().default([]),
      sources: z.array(sourceSchema).readonly().default([]),
      /** Shared definitions were added after schema version 1; old records default to empty. */
      definitions: z.array(definitionSchema).readonly().default([]),
      assets: z.array(assetSchema).readonly().default([]),
      arrangement: layoutSchema,
    })
    .readonly(),
);

/** A parsed collection: the canonical diagram data every section (view) shows. */
export type Collection = z.infer<typeof collectionSchema>;

/**
 * Drops an empty `changes` list before parsing. The removed canvas 2 syntax saved one on every
 * collection; dropping it lets those saves still open. A non-empty list is kept, so it stays
 * invalid.
 *
 * Reads `value.changes` first (for any value except `null` and `undefined`). When the list is
 * empty, `Object.entries` then reads every own enumerable string-keyed field, `changes`
 * included (so a `changes` getter runs twice), and a new object with every field except `changes`
 * is returned; symbol-keyed fields are not copied. Otherwise returns `value` itself.
 */
function dropEmptyChanges(value: unknown): unknown {
  const changes = (value as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes) || changes.length > 0) {
    return value;
  }
  return Object.fromEntries(Object.entries(value as object).filter(([key]) => key !== 'changes'));
}
