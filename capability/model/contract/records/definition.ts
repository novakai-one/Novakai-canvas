import { z } from 'zod';
import { definitionId, label } from '../brands.js';

/**
 * The primitive type names a definition can use: `string`, `number`, `boolean`, `unknown`,
 * `void`. Deliberately small.
 */
export const primitiveType = z.enum(['string', 'number', 'boolean', 'unknown', 'void']);
/** A literal type's value: a string, number or boolean. */
const literalType = z.union([z.string(), z.number(), z.boolean()]);

/**
 * A definition's type: a primitive, a literal value, a reference to another definition, or a
 * union of at least two expressions.
 */
export type TypeExpression =
  | { readonly kind: 'primitive'; readonly name: z.infer<typeof primitiveType> }
  | { readonly kind: 'literal'; readonly value: z.infer<typeof literalType> }
  | { readonly kind: 'reference'; readonly id: z.infer<typeof definitionId> }
  | { readonly kind: 'union'; readonly items: readonly TypeExpression[] };

/**
 * The recursive type-expression schema. `z.lazy` lets a union refer back to this schema. zod
 * calls the builder on first parse and reuses that inner schema for later parses; `unwrap()`
 * calls the builder again each time, so it returns a new inner schema.
 */
const typeExpressionSchema: z.ZodType<TypeExpression> = z.lazy(
  /** Builds the discriminated union (called by zod when it resolves the lazy schema). */
  () =>
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('primitive'), name: primitiveType }).readonly(),
      z.strictObject({ kind: z.literal('literal'), value: literalType }).readonly(),
      z.strictObject({ kind: z.literal('reference'), id: definitionId }).readonly(),
      z
        .strictObject({
          kind: z.literal('union'),
          items: z.array(typeExpressionSchema).min(2).readonly(),
        })
        .readonly(),
    ]),
);

/**
 * A named shared type owned by the collection: `id`, `label` and `expression`. The ID stays the
 * same when the label or expression is edited. Strict: unknown fields are rejected. Exported,
 * shared and unfrozen; `parse` throws a `ZodError`.
 */
export const definitionSchema = z
  .strictObject({ id: definitionId, label, expression: typeExpressionSchema })
  .readonly();

/** A parsed shared type definition. */
export type Definition = z.infer<typeof definitionSchema>;

/**
 * A field's type: either a nonblank string written in place (the older form), or
 * `{ kind: 'definition', id }` referring to a shared definition.
 */
export const fieldTypeSchema = z.union([
  label,
  z.strictObject({ kind: z.literal('definition'), id: definitionId }).readonly(),
]);

/** A parsed field type: a string or a definition reference. */
export type FieldType = z.infer<typeof fieldTypeSchema>;

/**
 * The type used by fields, members and signature parameters and returns. The same schema object
 * as {@link fieldTypeSchema}.
 */
export const typeUseSchema = fieldTypeSchema;
/** A parsed type use; the same as {@link FieldType}. */
export type TypeUse = FieldType;
