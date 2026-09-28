/*
 * Why this file exists
 *
 * An export request arrives as JSON, for example `{ identity: { collectionId: 'my-diagram',
 * revision: 3 }, format: 'png', scope: { kind: 'all' } }`. Before anything is exported, its shape
 * must be checked: a known format, a whole revision number, a scale from 1 to 4.
 *
 * This file holds the schemas that check it, using Model's own ID checks for the collection and
 * section. core/export runs the check. A refused request comes back as `invalid-input`; the caller
 * fixes it and sends it again.
 */
import { z } from 'zod';
import { collectionId, sectionId } from '../../schemas.js';

/**
 * Checks what to export: which collection at which revision, the format, and the whole collection
 * or one section. A revision is any whole number from 0 up. (`.int()` is not used: it also refuses
 * numbers above 2^53 − 1, which this check has never done.) Extra keys are ignored.
 */
export const exportSelection = z.object({
  identity: z.object({
    collectionId,
    revision: z.number().nonnegative().refine(Number.isInteger),
  }),
  format: z.enum(['dsl', 'svg', 'png', 'markdown']),
  scope: z.union([
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('section'), id: sectionId }),
  ]),
});

/**
 * Checks a whole export request: what to export, plus the scale (1 to 4; 1 when left out). The
 * scale is checked only after what to export.
 */
export const exportRequest = exportSelection.extend({
  scale: z.number().min(1).max(4).default(1),
});

/** One export request that passed {@link exportRequest}. */
export type ExportRequest = z.infer<typeof exportRequest>;
