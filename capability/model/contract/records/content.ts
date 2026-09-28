import { z } from 'zod';
import { assetId, descendantId, label, objectId, sectionId, size } from '../brands.js';
import { fieldTypeSchema, typeUseSchema } from './definition.js';
import { figureLevelSchema, textRoleSchema } from './composition.js';

/*
 * The content blocks an object can hold. Every block is strict (unknown fields rejected), parses
 * to a read-only value, and has an `id` unique within its owning object. Which blocks an object
 * kind allows, and every reference, are checked by Model core. The exported schemas are shared,
 * unfrozen objects; `parse` throws a `ZodError`.
 */

/**
 * An address: `{ object, member? }`. Without `member` it names the whole object; with it, one of
 * the object's ports, fields, members, signatures or rows. Shared by relationships, sections and
 * key references.
 */
export const endpointSchema = z
  .strictObject({ object: objectId, member: descendantId.optional() })
  .readonly();

/** Plain text; `role` defaults to `body`. */
const textBlockSchema = z
  .strictObject({
    kind: z.literal('text'),
    id: descendantId,
    text: z.string(),
    role: textRoleSchema.default('body'),
  })
  .readonly();

/** Code shown as text (never run), with an optional language name. */
const codeBlockSchema = z
  .strictObject({
    kind: z.literal('code'),
    id: descendantId,
    text: z.string(),
    language: z.string().optional(),
  })
  .readonly();

/** A list of strings; `ordered` defaults to `false`. */
const listBlockSchema = z
  .strictObject({
    kind: z.literal('list'),
    id: descendantId,
    items: z.array(z.string()).readonly(),
    ordered: z.boolean().default(false),
  })
  .readonly();

/**
 * An image or icon from the asset manifest; `size` defaults to `medium`, `fit` to `contain`.
 */
const imageBlockSchema = z
  .strictObject({
    kind: z.enum(['image', 'icon']),
    id: descendantId,
    asset: assetId,
    size: size.default('medium'),
    fit: z.enum(['contain', 'cover']).default('contain'),
  })
  .readonly();
/**
 * A figure drawn by the app from theme tokens (never from assets). `form` selects one of 10
 * forms, each with its own named parameters and defaults; `size` defaults to `medium`.
 */
const figureBlockSchema = z.discriminatedUnion('form', [
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('vessel'),
      level: figureLevelSchema.default('half'),
      agitator: z.boolean().default(false),
      mark: z.enum(['none', 'check', 'shield']).default('none'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('layered-bed'),
      level: figureLevelSchema.default('full'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('screen'),
      debris: z.enum(['none', 'some']).default('some'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('gauge'),
      level: figureLevelSchema.default('half'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('window'),
      fill: figureLevelSchema.default('half'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('gate'),
      pass: z.enum(['one', 'few']).default('few'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('stack'),
      layers: z.enum(['few', 'some', 'many']).default('some'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('store'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('queue'),
      level: figureLevelSchema.default('half'),
      size: size.default('medium'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('figure'),
      id: descendantId,
      form: z.literal('cloud'),
      size: size.default('medium'),
    })
    .readonly(),
]);

/**
 * A link's target: an object in this collection (optionally in a given section), or an external
 * URI that Model does not check.
 */
const linkTargetSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('object'), id: objectId, section: sectionId.optional() })
    .readonly(),
  z.strictObject({ kind: z.literal('uri'), uri: label }).readonly(),
]);

/** A labelled link to a {@link linkTargetSchema} target. */
const linkBlockSchema = z
  .strictObject({ kind: z.literal('link'), id: descendantId, label, target: linkTargetSchema })
  .readonly();

/**
 * An entity field: `label`, `type`, `nullable` (default `false`), optional `key` (`primary`,
 * `foreign` or `unique`) and optional `references`. Core requires `references` only for a foreign
 * key.
 */
const fieldSchema = z
  .strictObject({
    kind: z.literal('field'),
    id: descendantId,
    label,
    type: fieldTypeSchema,
    nullable: z.boolean().default(false),
    key: z.enum(['primary', 'foreign', 'unique']).optional(),
    references: endpointSchema.optional(),
  })
  .readonly();

/**
 * A composite key over at least one of the object's fields, in order. The order matters: a
 * foreign key group's fields are matched in order to its `references`.
 */
const keyGroupSchema = z
  .strictObject({
    kind: z.literal('keygroup'),
    id: descendantId,
    key: z.enum(['primary', 'foreign', 'unique']),
    fields: z.array(descendantId).min(1).readonly(),
    references: z.array(endpointSchema).readonly().optional(),
  })
  .readonly();

/**
 * A callable signature shown as structured content: `label`, parameters (a plain name, or
 * `{ name, type }`) and a `returns` type. Never executed.
 */
const signatureSchema = z
  .strictObject({
    kind: z.literal('signature'),
    id: descendantId,
    label,
    parameters: z
      .array(z.union([label, z.strictObject({ name: label, type: typeUseSchema }).readonly()]))
      .readonly(),
    returns: typeUseSchema,
  })
  .readonly();

/** A typed member; `visibility` defaults to `public`. */
const memberSchema = z
  .strictObject({
    kind: z.literal('member'),
    id: descendantId,
    label,
    type: typeUseSchema,
    visibility: z.enum(['public', 'private', 'protected']).default('public'),
  })
  .readonly();

/**
 * A table row: `id` (unique among the owning object's descendants) and its cells. Core checks the
 * cell count against the columns.
 */
const tableRowSchema = z
  .strictObject({ id: descendantId, cells: z.array(z.string()).readonly() })
  .readonly();

/** A table with at least one column and any number of rows. */
const tableBlockSchema = z
  .strictObject({
    kind: z.literal('table'),
    id: descendantId,
    columns: z.array(label).min(1).readonly(),
    rows: z.array(tableRowSchema).readonly(),
  })
  .readonly();

/**
 * One content block, chosen by `kind`: text, code, list, image or icon, figure, link, field,
 * keygroup, signature, member or table. Core checks which kinds each object allows and every
 * reference. Presentation uses the `ContentBlock` type, not this schema.
 */
export const contentSchema = z.union([
  textBlockSchema,
  codeBlockSchema,
  listBlockSchema,
  imageBlockSchema,
  figureBlockSchema,
  linkBlockSchema,
  fieldSchema,
  keyGroupSchema,
  signatureSchema,
  memberSchema,
  tableBlockSchema,
]);

/**
 * A named connection point on an object: `id`, `direction` (`in`, `out` or `inout`), `label` and
 * a `type` label. Its ID is unique within the owning object.
 */
export const portSchema = z
  .strictObject({ id: descendantId, direction: z.enum(['in', 'out', 'inout']), label, type: label })
  .readonly();

/** One parsed content block; check `kind` before reading kind-specific fields. */
export type ContentBlock = z.infer<typeof contentSchema>;

/** A parsed address: a whole object, or one member of it. */
export type Endpoint = z.infer<typeof endpointSchema>;

/** A parsed entity field; a foreign key's reference is checked against a candidate key. */
export type Field = Extract<ContentBlock, { kind: 'field' }>;

/** A parsed figure block; check `form` before reading form-specific parameters. */
export type FigureBlock = Extract<ContentBlock, { kind: 'figure' }>;

/** A parsed composite primary, unique or foreign key over the owning entity's fields. */
export type KeyGroup = Extract<ContentBlock, { kind: 'keygroup' }>;
