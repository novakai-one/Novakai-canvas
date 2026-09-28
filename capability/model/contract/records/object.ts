import { z } from 'zod';
import { label, objectId, size, sourceId } from '../brands.js';
import { contentSchema, portSchema } from './content.js';
import { frameSchema, compositionSchema } from './composition.js';

/**
 * The 15 object kinds (for example `step`, `decision`, `entity`, `module`, `function`,
 * `state`, `note`). The kind is the object's meaning, the same in every section that shows it.
 */
export const objectKind = z.enum([
  'step',
  'start',
  'end',
  'decision',
  'fork',
  'join',
  'entity',
  'module',
  'interface',
  'function',
  'state',
  'participant',
  'concept',
  'system',
  'note',
]);

/**
 * An object (diagram node): `id`, `kind`, `label`, `role` (default `neutral`), `size` (default
 * `medium`), `frame` (default `auto`), `composition` (default `stack`), optional positive whole
 * `step`, and lists of `content`, `ports` and provenance `sources` (each default empty).
 * Section-specific geometry lives in sections, not here. Exported, shared and unfrozen; `parse`
 * throws a `ZodError`. Authoring owns correction, commit and recovery.
 */
export const objectSchema = z
  .strictObject({
    id: objectId,
    kind: objectKind,
    label,
    role: label.default('neutral'),
    size: size.default('medium'),
    frame: frameSchema.default('auto'),
    composition: compositionSchema.default('stack'),
    step: z.number().int().positive().optional(),
    content: z.array(contentSchema).readonly().default([]),
    ports: z.array(portSchema).readonly().default([]),
    sources: z.array(sourceId).readonly().default([]),
  })
  .readonly();

/** A parsed object. Several sections may show it without copying it. */
export type DiagramObject = z.infer<typeof objectSchema>;

/** One of the 15 object kinds. */
export type ObjectKind = z.infer<typeof objectKind>;
