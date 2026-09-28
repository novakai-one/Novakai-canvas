/*
 * Why this file exists
 *
 * A change request names the Authoring planner that turns it into a write, and carries that
 * planner's payload (its "command"). For example, a DSL change carries
 * `{ source: 'collection my-diagram …', mode: 'replace' }`.
 *
 * This file holds each planner's check of its payload's outer shape: DSL, Model, Library, the
 * preset header, and the private `initialize` command only start-up sends. What is inside (DSL
 * text, Model or Library changes, the preset) is checked by its own capability.
 */
import { z } from 'zod';
/**
 * Checks a DSL planner payload: the DSL text (at most 16 MiB), whether it creates, replaces or
 * patches a collection, and optionally the exact theme each theme name stands for (see
 * `ResourceCommands.freeze`). Language checks the DSL text.
 */
export const dslCommand = z
  .strictObject({
    source: z.string().max(16 * 1024 * 1024),
    mode: z.enum(['create', 'replace', 'patch']),
    themePins: z.record(z.string(), z.string()).optional(),
  })
  .readonly();
/** A DSL planner payload that passed {@link dslCommand}. */
export type DslCommand = z.infer<typeof dslCommand>;
/**
 * Checks a Model planner payload: the collection ID as text (1–128 characters) and up to 1000
 * Model changes, which Model checks.
 */
export const modelCommand = z
  .strictObject({ collection: z.string().min(1).max(128), changes: z.array(z.unknown()).max(1000) })
  .readonly();
/** A Model planner payload that passed {@link modelCommand}. */
export type ModelCommand = z.infer<typeof modelCommand>;
/**
 * Checks the header of a preset (a theme or a recipe) being saved: which kind it is and, for a
 * recipe, its DSL text. Templates checks the rest.
 */
export const presetHeader = z.looseObject({
  kind: z.enum(['theme', 'recipe']),
  source: z.string().optional(),
});
/** A preset header that passed {@link presetHeader}. */
export type PresetHeader = z.infer<typeof presetHeader>;
/**
 * Checks a preset planner payload far enough to find its header (`admission` is the preset to
 * save); resource selection reads only that. The full payload check is `presetCommand`
 * (records/presets/preparation.ts).
 */
export const presetChange = z.looseObject({ admission: presetHeader });
/**
 * Checks the private `initialize` command, which fills a brand-new workspace with its seed. HTTP
 * can never send it.
 */
export const initializeCommand = z.strictObject({ action: z.literal('initialize') });
/**
 * Checks a Library planner payload: up to 1000 catalog changes, which Library checks as one batch.
 */
export const libraryCommand = z
  .strictObject({ changes: z.array(z.unknown()).max(1000) })
  .readonly();
