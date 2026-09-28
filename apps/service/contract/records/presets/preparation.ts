/*
 * Why this file exists
 *
 * Saving a theme or recipe (a "preset") takes two steps. `POST /api/v1/resources/prepare` checks it
 * and answers exactly what would be saved, saving nothing. Then the caller sends that as a change,
 * and the preset planner prepares it again to make sure nothing moved in between.
 *
 * This file holds the prepared preset (`PresetPreparation`), the preset planner's check of it
 * (`presetCommand`), and a way to read a preset as named fields (`presetFields`). The field names
 * are sent over HTTP and stored with each change, so they stay as they are. Declarations only.
 */
import { z } from 'zod';
import type { ReadVersion, RecordKey } from '../capability-types.js';
import type { Pin } from '@novakai/canvas-templates';

/**
 * Checks a preset as named fields, so one field can be replaced: a recipe's DSL text (resource
 * commands) or a theme's `raw` block (theme saving).
 */
export const presetFields = z.record(z.string(), z.json());

/**
 * Checks the preset planner's payload: a prepared preset exactly as `preparePreset` answered it.
 * The planner prepares it again and refuses it if anything changed.
 */
export const presetCommand = z.strictObject({
  admission: z.json(),
  record: z.json(),
  pin: z.strictObject({
    kind: z.enum(['theme', 'recipe']),
    id: z.string(),
    version: z.string(),
    digest: z.string(),
  }),
  key: z.strictObject({ kind: z.literal('preset'), id: z.string() }),
  resources: z.array(z.string()),
  reads: z.array(
    z.strictObject({
      key: z.strictObject({ kind: z.string(), id: z.string() }),
      version: z.union([z.number(), z.literal('absent')]),
    }),
  ),
});
/** A preset planner payload that passed {@link presetCommand}. */
export type PresetCommand = z.infer<typeof presetCommand>;

/** Any JSON value, as a `z.json()` check reads it. */
type CheckedJson = z.infer<ReturnType<typeof z.json>>;

/**
 * A prepared preset: exactly what would be saved, and what was read to make it. Nothing is saved
 * yet.
 */
export interface PresetPreparation {
  /** The preset to save; a theme's source syntax is already translated. */
  readonly admission: CheckedJson;
  /** The record Templates would store. */
  readonly record: CheckedJson;
  /** The exact version (kind, ID, version, digest) the preset would get. */
  readonly pin: Pin;
  /** Where the record would be stored. */
  readonly key: RecordKey;
  /**
   * The digests (as text) of the uploaded files it uses. Assets checks them when the planner
   * prepares the preset again.
   */
  readonly resources: readonly string[];
  /**
   * The stored records read to prepare it, with their versions (the catalog's revision among them).
   */
  readonly reads: readonly ReadVersion[];
}
