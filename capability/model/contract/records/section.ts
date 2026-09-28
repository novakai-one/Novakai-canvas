import { z } from 'zod';
import {
  descendantId,
  groupId,
  label,
  objectId,
  relationshipId,
  sectionId,
  size,
} from '../brands.js';
import { layoutSchema, placementSchema, pointSchema } from './layout.js';
import { frameSchema, compositionSchema, containerFrameSchema } from './composition.js';
import { endpointSchema } from './content.js';

/**
 * How one object appears in one section: optional `group` (omitted means the section's top
 * level), optional `role`, `size`, `frame`, `composition` and `placement` overrides (omitted ones
 * inherit the object's values or automatic layout), `detail` (default `full`) and optional tree
 * `participation`. Exported, shared and unfrozen; `parse` throws a `ZodError`.
 */
export const appearanceSchema = z
  .strictObject({
    object: objectId,
    group: groupId.optional(),
    role: label.optional(),
    size: size.optional(),
    frame: frameSchema.optional(),
    composition: compositionSchema.optional(),
    detail: z.enum(['full', 'summary', 'label']).default('full'),
    participation: z.enum(['tree', 'annotation']).optional(),
    placement: placementSchema.optional(),
  })
  .readonly();

/**
 * A container in one section: `id`, `title`, optional `parent` group, optional `represents`
 * (the object the group stands for, instead of an ordinary appearance), `frame` (default
 * `auto`), `role` (default `neutral`), its own `layout` and optional `placement`. Exported,
 * shared and unfrozen; `parse` throws a `ZodError`.
 */
export const groupSchema = z
  .strictObject({
    id: groupId,
    title: label,
    parent: groupId.optional(),
    represents: objectId.optional(),
    frame: containerFrameSchema.default('auto'),
    role: label.default('neutral'),
    layout: layoutSchema,
    placement: placementSchema.optional(),
  })
  .readonly();

/** Where a wire attaches: `auto` (routing chooses) or a named side the author fixed. */
const attachmentSideSchema = z.enum(['auto', 'top', 'right', 'bottom', 'left']);

/**
 * How one relationship is drawn in one section: `route` (default `orthogonal`), attachment sides
 * (default `auto`), optional `manual` points (at least 2) and `locked` (default `false`). Core
 * requires `manual` points when `locked` is true (`layout`, "Locked route requires manual
 * points"). Replacing a section keeps an old manual route and its lock together when the new wire
 * omits `manual`. Exported, shared and unfrozen; `parse` throws a `ZodError`.
 */
export const wireSchema = z
  .strictObject({
    relationship: relationshipId,
    route: z.enum(['orthogonal', 'curve']).default('orthogonal'),
    sourceSide: attachmentSideSchema.default('auto'),
    targetSide: attachmentSideSchema.default('auto'),
    manual: z.array(pointSchema).min(2).readonly().optional(),
    locked: z.boolean().default(false),
  })
  .readonly();

/**
 * Fields every sequence item has: `id`, optional `parent` fragment and `branch`, and `order`
 * (0 or more) within that parent and branch. Root items omit both. A plain object spread into both
 * item schemas, so they share these field schema objects.
 */
const sequenceScopeFields = {
  id: descendantId,
  parent: descendantId.optional(),
  branch: descendantId.optional(),
  order: z.number().int().nonnegative(),
};

/**
 * A labelled message between two endpoints, each a visible participant or a module shown directly
 * at the section's top level: `call`, `return` or `async`, optionally naming the called
 * `operation` and changing activation.
 */
const sequenceEventSchema = z
  .strictObject({
    ...sequenceScopeFields,
    kind: z.literal('event'),
    source: objectId,
    target: objectId,
    label,
    message: z.enum(['call', 'return', 'async']),
    operation: endpointSchema.optional(),
    activate: z.boolean().optional(),
  })
  .readonly();

/** A named alternative inside an `alt` fragment; its ID is unique across the sequence. */
const sequenceBranchSchema = z.strictObject({ id: descendantId, label }).readonly();

/**
 * A control fragment: `alt`, `opt` or `loop`, with a label and `branches` (default none). Core
 * requires two or more branches for `alt` and none for `opt` and `loop`.
 */
const sequenceFragmentSchema = z
  .strictObject({
    ...sequenceScopeFields,
    kind: z.literal('fragment'),
    operator: z.enum(['alt', 'opt', 'loop']),
    label,
    branches: z.array(sequenceBranchSchema).readonly().default([]),
  })
  .readonly();

/**
 * One sequence item: a message event or a control fragment. Core checks IDs and parent/branch
 * scope. Exported, shared and unfrozen; `parse` throws a `ZodError`.
 */
export const sequenceSchema = z.union([sequenceEventSchema, sequenceFragmentSchema]);

/**
 * The 8 section modes: `flow`, `er`, `modules`, `tree`, `sequence`, `state`, `story`, `grid`.
 * Each has its own structure rules and compatible layouts (see `policies.ts`).
 */
export const modeSchema = z.enum([
  'flow',
  'er',
  'modules',
  'tree',
  'sequence',
  'state',
  'story',
  'grid',
]);

/**
 * One diagram view (section): `id`, `title`, `mode`, `order` (any integer, negatives included;
 * default 0), `layout`, lists of `appearances`, `groups`, `wires` and `sequence` items (each
 * default empty), an optional tree `root` and optional `placement`. Exported, shared and
 * unfrozen; `parse` throws a `ZodError`. Authoring owns correction, commit and recovery.
 */
export const sectionSchema = z
  .strictObject({
    id: sectionId,
    title: label,
    mode: modeSchema,
    order: z.number().int().default(0),
    layout: layoutSchema,
    appearances: z.array(appearanceSchema).readonly().default([]),
    groups: z.array(groupSchema).readonly().default([]),
    wires: z.array(wireSchema).readonly().default([]),
    root: objectId.optional(),
    sequence: z.array(sequenceSchema).readonly().default([]),
    placement: placementSchema.optional(),
  })
  .readonly();

/** A parsed section. The objects it shows are owned by the collection. */
export type Section = z.infer<typeof sectionSchema>;

/** A parsed appearance of one object in one section. */
export type Appearance = z.infer<typeof appearanceSchema>;

/** A parsed container; a group that `represents` an object replaces its ordinary appearance. */
export type Group = z.infer<typeof groupSchema>;

/** A parsed wire: one relationship's route controls in one section. */
export type WireAppearance = z.infer<typeof wireSchema>;

/** A parsed sequence item, ordered within its parent and branch. */
export type SequenceItem = z.infer<typeof sequenceSchema>;

/** One of the 8 section modes. */
export type Mode = z.infer<typeof modeSchema>;
