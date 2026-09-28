/*
 * The Model identities Language's collection profiles name source IDs with. Model owns the ID
 * grammar and its brands; they are re-exported here, never copied, so core checks an ID without
 * importing Model. Pure declarations. The lexer reads `@id` with the same grammar, so every ID a
 * parsed reference holds passes these checks.
 */
import type { Collection, Relationship } from '@novakai/canvas-model';

export { descendantId, objectId, relationshipId, sectionId } from '@novakai/canvas-model';
export type { DescendantId, ObjectId, SectionId } from '@novakai/canvas-model';

/** A collection's ID, as Model brands it. Model exports the schema, not the type. */
export type CollectionId = Collection['id'];

/** A wire's (relationship's) ID, as Model brands it. Model exports the schema, not the type. */
export type RelationshipId = Relationship['id'];

/** The part of a Model ID schema a check uses: `safeParse`, and the branded ID it gives. */
export interface IdParser<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}
