import { z } from 'zod';

/**
 * Checked IDs and small shared value schemas.
 *
 * Every ID uses one grammar: a letter, then letters, digits, `_` or `-`. The branded ID schemas
 * below are the same runtime object as {@link identifier} (zod's `.brand()` is type-only), so they
 * accept the same strings; the brands keep the ID kinds apart in TypeScript only.
 *
 * Use `safeParse` to build a checked value: it returns a result object. `parse` throws a
 * `ZodError` on invalid input. These schemas are exported objects shared by every caller; they
 * are not frozen.
 */

/** The shared ID grammar: a letter, then letters, digits, `_` or `-`. */
export const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

/** A collection's ID; never interchangeable with its child records' IDs. */
export const collectionId = identifier.brand<'CollectionId'>();

/** A canonical object's ID within its collection. */
export const objectId = identifier.brand<'ObjectId'>();

/** A canonical relationship's ID within its collection. */
export const relationshipId = identifier.brand<'RelationshipId'>();

/** A diagram view's (section's) ID within its collection. */
export const sectionId = identifier.brand<'SectionId'>();

/** An asset manifest entry's ID; distinct from its content digest. */
export const assetId = identifier.brand<'AssetId'>();

/** A provenance entry's ID within its collection. */
export const sourceId = identifier.brand<'SourceId'>();

/** A shared type definition's ID within its collection. */
export const definitionId = identifier.brand<'DefinitionId'>();

/** A container's ID within one section. */
export const groupId = identifier.brand<'GroupId'>();

/** A port's, content block's or table row's ID within its owning scope. */
export const descendantId = identifier.brand<'DescendantId'>();

/**
 * Display text that is not blank: at least one non-whitespace character ("Must be nonblank").
 * The original whitespace is kept.
 */
export const label = z.string().refine(
  /** Tells whether the text has a non-whitespace character. */
  (value): boolean => value.trim().length > 0,
  'Must be nonblank',
);

/**
 * A pinned SHA-256 content identity: `sha256:` then 64 lowercase hex digits. Model checks the
 * syntax only and never fetches bytes.
 */
export const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** A semantic size preference. Layout picks the dimensions; authors never supply pixels. */
export const size = z.enum(['small', 'medium', 'large']);

/** An object ID checked by {@link objectId}. */
export type ObjectId = z.infer<typeof objectId>;

/** A collection ID checked by {@link collectionId}. */
export type CollectionId = z.infer<typeof collectionId>;

/** A section ID checked by {@link sectionId}. */
export type SectionId = z.infer<typeof sectionId>;

/** A relationship ID checked by {@link relationshipId}. */
export type RelationshipId = z.infer<typeof relationshipId>;

/** A descendant (port, content block or row) ID checked by {@link descendantId}. */
export type DescendantId = z.infer<typeof descendantId>;

/** An asset manifest ID checked by {@link assetId}. */
export type AssetId = z.infer<typeof assetId>;

/** A provenance ID checked by {@link sourceId}. */
export type SourceId = z.infer<typeof sourceId>;

/** A shared definition ID checked by {@link definitionId}. */
export type DefinitionId = z.infer<typeof definitionId>;

/** A section-local container ID checked by {@link groupId}. */
export type GroupId = z.infer<typeof groupId>;
