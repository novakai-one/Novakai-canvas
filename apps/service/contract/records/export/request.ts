/*
 * The export request the service boundary parses: identity, format, scope and scale. The
 * collection and section IDs use Model's ID schemas. Declarations only; core/export/request.ts
 * reads it, and a refused request is the caller's to correct and resend.
 */
import { z } from 'zod';
import { collectionId, sectionId } from '../../schemas.js';

/**
 * What to export: identity, format and scope. A failure here is an unsupported request.
 * Revision is any non-negative integer; `.int()` is avoided because it also caps at safe
 * integers, which the boundary has never done. Extra keys are ignored, never rejected.
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

/** A complete export request; scale defaults to 1 and is judged only after the selection. */
export const exportRequest = exportSelection.extend({
  scale: z.number().min(1).max(4).default(1),
});

/** One checked export request. */
export type ExportRequest = z.infer<typeof exportRequest>;
