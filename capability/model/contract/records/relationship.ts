import { z } from 'zod';
import { label, relationshipId, sourceId } from '../brands.js';
import { endpointSchema } from './content.js';

/**
 * The 9 relationship kinds: `flow`, `association`, `imports`, `calls`, `implements`,
 * `contains`, `parent`, `reference`, `transition`. Core checks each kind's endpoints (see
 * `policies.ts`).
 */
export const relationshipKind = z.enum([
  'flow',
  'association',
  'imports',
  'calls',
  'implements',
  'contains',
  'parent',
  'reference',
  'transition',
]);

/** An ER multiplicity for one end: `0..1`, `1`, `0..many` or `1..many`. */
const cardinalitySchema = z.enum(['0..1', '1', '0..many', '1..many']);

/**
 * A labelled relationship: `id`, `kind`, `label`, optional positive whole `step` (at most
 * `Number.MAX_SAFE_INTEGER`), `source` and `target` addresses, `from`/`to` cardinalities,
 * optional state `guard` and `effect`, `style` (default `solid`) and provenance `sources`
 * (default empty). The schema makes `from`/`to` optional; core requires both on an association
 * and forbids them on every other kind (`endpoint`). Exported, shared and unfrozen; `parse`
 * throws a `ZodError`. Authoring owns correction, commit and recovery.
 */
export const relationshipSchema = z
  .strictObject({
    id: relationshipId,
    kind: relationshipKind,
    label,
    step: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    source: endpointSchema,
    target: endpointSchema,
    from: cardinalitySchema.optional(),
    to: cardinalitySchema.optional(),
    guard: z.string().optional(),
    effect: z.string().optional(),
    style: z.enum(['solid', 'dashed']).default('solid'),
    sources: z.array(sourceId).readonly().default([]),
  })
  .readonly();

/** A parsed relationship. Each section draws it with its own wire (route geometry). */
export type Relationship = z.infer<typeof relationshipSchema>;

/** One of the 9 relationship kinds. */
export type RelationshipKind = z.infer<typeof relationshipKind>;
