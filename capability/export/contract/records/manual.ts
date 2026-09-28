/*
 * The manual snapshot a bundle carries: the stored human layout decisions (placements, orders,
 * wire sides and bend points) that the DSL source does not hold. Automatic geometry is not
 * included; Layout recomputes it. The schema checks structure and size only; import checks that
 * every override points at a real section, object, group or wire.
 *
 * The private schemas below are declared before `manualSchema` because it is built from them.
 * `point` and `placement` are each one shared instance, reused where they appear. The exported
 * schema is a shared, unfrozen object; its `parse` throws a `ZodError`.
 */
import { z } from 'zod';
import { identity } from '../brands.js';
import { PROJECTION_CAPACITY } from './limits.js';

/**
 * A stored position `{ x, y }` in the coordinate frame of whatever owns it: placements are
 * relative to their parent (section or group), route points are section-local.
 */
const point = z.strictObject({ x: z.number(), y: z.number() });

/** A stored position with optional positive `width` and `height`, and whether it is locked. */
const placement = point.extend({
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  locked: z.boolean(),
});

/** Which side of a node a wire attaches to; `auto` lets Layout choose. */
const side = z.enum(['auto', 'top', 'right', 'bottom', 'left']);

/** A stored placement for one object appearance. */
const appearance = z.strictObject({
  /** ID of the object whose appearance this places. */
  object: identity,
  placement,
});

/** A stored placement for one group. */
const group = z.strictObject({
  /** The group's ID within its section. */
  id: identity,
  placement,
});

/** One wire's stored attachment sides, lock and optional bend points (2–10,000). */
const wire = z.strictObject({
  /** ID of the relationship this wire draws. */
  relationship: identity,
  /** Stored bend points, when the route was drawn by hand. */
  manual: z.array(point).min(2).max(10000).optional(),
  /** `true` when automatic layout must keep this route. */
  locked: z.boolean(),
  /** Where the wire leaves its source node. */
  sourceSide: side,
  /** Where the wire enters its target node. */
  targetSide: side,
});

/**
 * One section's overrides: the order of its appearances, groups and sequence items, its own
 * optional placement, and the placed appearances, placed groups and wires. List sizes are
 * capped by the projection capacity (sequence order at 10,000).
 */
const section = z.strictObject({
  /** The section's ID. */
  id: identity,
  /** Object IDs in the order their appearances are listed. */
  appearanceOrder: z.array(identity).max(PROJECTION_CAPACITY.maxNodes),
  /** Group IDs in their listed order. */
  groupOrder: z.array(identity).max(PROJECTION_CAPACITY.maxNodes),
  /** Each sequence item's ID with its stored order number. */
  sequenceOrder: z
    .array(z.strictObject({ id: identity, order: z.number().int().nonnegative() }))
    .max(10000),
  /** The section's own stored placement, if any. */
  placement: placement.optional(),
  /** Appearances that have a stored placement. */
  appearances: z.array(appearance).max(PROJECTION_CAPACITY.maxNodes),
  /** Groups that have a stored placement. */
  groups: z.array(group).max(PROJECTION_CAPACITY.maxNodes),
  /** Every wire's stored sides, lock and bend points. */
  wires: z.array(wire).max(PROJECTION_CAPACITY.maxWires),
});

/**
 * A whole manual snapshot: `schemaVersion` 1 and a list of section entries (at most the
 * projection's section capacity). Capturing a collection produces one entry per section, but
 * the schema itself accepts an empty list and repeated section IDs; import then rejects
 * duplicate or unknown targets. Extra fields are rejected at every level. The parsed top-level
 * record is frozen; nested records are not.
 */
export const manualSchema = z
  .strictObject({
    /** Manual snapshot version; always 1. */
    schemaVersion: z.literal(1),
    /** One entry per section with stored overrides. */
    sections: z.array(section).max(PROJECTION_CAPACITY.maxSections),
  })
  .readonly();

/** A parsed manual snapshot. */
export type ManualSnapshot = z.infer<typeof manualSchema>;

/** One section's parsed overrides. */
export type ManualSection = ManualSnapshot['sections'][number];
