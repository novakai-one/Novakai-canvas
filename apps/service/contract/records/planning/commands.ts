/*
 * Planner payload schemas: the envelopes the service's planners and resource selection decode.
 * Declarations only; Model, Language, Library and Templates own the contents and their failures.
 */
import { z } from 'zod';
/** Human and DSL envelopes select different public planners; Model/Language own the contained change vocabulary. */
export const dslCommand = z
  .strictObject({
    source: z.string().max(16 * 1024 * 1024),
    mode: z.enum(['create', 'replace', 'patch']),
    themePins: z.record(z.string(), z.string()).optional(),
  })
  .readonly();
export type DslCommand = z.infer<typeof dslCommand>;
export const modelCommand = z
  .strictObject({ collection: z.string().min(1).max(128), changes: z.array(z.unknown()).max(1000) })
  .readonly();
/** A preset admission's header: the kind it admits and, for a recipe, its DSL source. Templates checks the rest. */
export const presetAdmission = z.looseObject({
  kind: z.enum(['theme', 'recipe']),
  source: z.string().optional(),
});
export type PresetAdmission = z.infer<typeof presetAdmission>;
/** A preset change names its admission; resource selection reads only the admission header. */
export const presetChange = z.looseObject({ admission: presetAdmission });
/** Library owns the inner catalog operation schema and validates the complete batch. */
export const libraryCommand = z
  .strictObject({ changes: z.array(z.unknown()).max(1000) })
  .readonly();
