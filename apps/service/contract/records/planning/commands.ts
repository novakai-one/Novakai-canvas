import { z } from 'zod';
/** Human and DSL envelopes select different public planners; Model/Language own the contained change vocabulary. */
export const dslCommand = z
  .strictObject({
    source: z.string().max(16 * 1024 * 1024),
    mode: z.enum(['create', 'replace', 'patch']),
    themePins: z.record(z.string(), z.string()).optional(),
  })
  .readonly();
export const modelCommand = z
  .strictObject({ collection: z.string().min(1).max(128), changes: z.array(z.unknown()).max(1000) })
  .readonly();
/** A preset admission's header: the kind it admits and, for a recipe, its DSL source. Templates checks the rest. */
export const presetAdmission = z.looseObject({
  kind: z.enum(['theme', 'recipe']),
  source: z.string().optional(),
});
/** Library owns the inner catalog operation schema and validates the complete batch. */
export const libraryCommand = z
  .strictObject({ changes: z.array(z.unknown()).max(1000) })
  .readonly();
