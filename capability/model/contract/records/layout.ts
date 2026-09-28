/*
 * Layout records: semantic layout requests, ordering constraints and stored placements. Parsed
 * objects and supplied lists are frozen; a defaulted empty list is a new, unfrozen array.
 * `validate` deep-freezes its results. `validate` reports problems as diagnostics; Authoring owns
 * correction, commit and recovery. The exported schemas are shared, unfrozen objects; `parse`
 * throws a `ZodError`.
 */
import { z } from 'zod';
import { objectId, groupId, sectionId } from '../brands.js';

/**
 * A route point `{ x, y }` computed by the app and stored. Authors never have to supply
 * coordinates.
 */
export const pointSchema = z.strictObject({ x: z.number(), y: z.number() }).readonly();

/**
 * A stored position `{ x, y }` with optional positive `width` and `height`. `locked` (default
 * `false`) marks a human layout decision that automatic layout keeps.
 */
export const placementSchema = z
  .strictObject({
    x: z.number(),
    y: z.number(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    locked: z.boolean().default(false),
  })
  .readonly();

/**
 * What a layout constraint points at: an object, a group or a section, each with its own ID kind.
 * Core checks that the target exists in the constraint's scope.
 */
export const layoutTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('object'), id: objectId }).readonly(),
  z.strictObject({ kind: z.literal('group'), id: groupId }).readonly(),
  z.strictObject({ kind: z.literal('section'), id: sectionId }).readonly(),
]);

/**
 * A relative rule (`rank`, `before`, `below` or `align`) over at least two targets. Core requires
 * exactly two targets for `before` and `below` ("before/below need exactly two targets").
 */
const constraintSchema = z
  .strictObject({
    kind: z.enum(['rank', 'before', 'below', 'align']),
    targets: z.array(layoutTargetSchema).min(2).readonly(),
  })
  .readonly();

/**
 * A layout request: `algorithm` (`flow`, `layered`, `tree`, `sequence` or `grid`), `direction`
 * (default `right`), `gap` (default `normal`), optional `columns` (1–12; core requires the `grid`
 * algorithm, "Columns require grid layout") and ordering `constraints` (default none). Model
 * checks the request; it never places nodes.
 */
export const layoutSchema = z
  .strictObject({
    algorithm: z.enum(['flow', 'layered', 'tree', 'sequence', 'grid']),
    direction: z.enum(['right', 'down', 'left', 'up']).default('right'),
    gap: z.enum(['compact', 'normal', 'roomy']).default('normal'),
    columns: z.number().int().min(1).max(12).optional(),
    constraints: z.array(constraintSchema).readonly().default([]),
  })
  .readonly();

/** A parsed layout request for one scope (collection, section or group). */
export type LayoutIntent = z.infer<typeof layoutSchema>;

/** A parsed constraint target: an object, group or section. */
export type LayoutTarget = z.infer<typeof layoutTargetSchema>;

/** A parsed stored placement; when absent, layout places the item automatically. */
export type Placement = z.infer<typeof placementSchema>;

/** One parsed ordering or alignment rule; core checks its targets' scope. */
export type LayoutConstraint = z.infer<typeof constraintSchema>;
