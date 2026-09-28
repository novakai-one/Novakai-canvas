/*
 * Why this file exists
 *
 * Saving a theme or recipe (a "preset") takes two steps. `POST /api/v1/resources/prepare` checks it
 * and answers exactly what would be saved, saving nothing. Then the caller sends that as a change,
 * and the preset planner prepares it again to make sure nothing moved in between.
 *
 * This file holds the checks for the resource command bodies (prepare, restore, instantiate), the
 * prepared preset (`PresetPreparation`), and the mistake a resource command answers with
 * (`ResourceDiagnostic`). Declarations only; the commands are in ports/workspace.ts.
 */
import type { FailureSource } from '../transport/failure-source.js';
import type { Result } from '../../errors.js';
import { z } from 'zod';
import type { ReadVersion, RecordKey } from '@novakai/canvas-authoring';
import type { Pin } from '@novakai/canvas-templates';
import type { AuthoringErrorCode, TemplatesErrorCode } from '../capabilities.js';
/**
 * Checks a prepare request: the preset to save, and the uploaded files it may use, each as a name
 * and a digest (none when left out).
 */
export const preparationInput = z.strictObject({
  admission: z.json(),
  assets: z.array(z.strictObject({ alias: z.string(), digest: z.string() })).default([]),
});
/** A prepare request that passed {@link preparationInput}. */
export type PreparationInput = z.infer<typeof preparationInput>;
/** Checks a restore request: the file's digest and its bytes as base64 text. */
export const restoreInput = z.strictObject({ digest: z.string(), base64: z.string() });
/** A restore request that passed {@link restoreInput}. */
export type RestoreInput = z.infer<typeof restoreInput>;
/**
 * Checks an instantiate request: the recipe's pin (Templates checks it) and the ID of the new
 * collection (`namespace`).
 */
export const instantiateInput = z.strictObject({ pin: z.unknown(), namespace: z.string() });
/** An instantiate request that passed {@link instantiateInput}. */
export type InstantiateInput = z.infer<typeof instantiateInput>;
/**
 * Reads a preset as named fields, so one field can be replaced: a recipe's DSL text (resource
 * commands) or a theme's `raw` block (theme admission).
 */
export const admissionFields = z.record(z.string(), z.json());
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
/**
 * A prepared preset: exactly what would be saved, and what was read to make it. Nothing is saved
 * yet.
 */
export interface PresetPreparation {
  /** The preset as it will be saved; a theme's source syntax is already translated. */
  readonly admission: z.infer<ReturnType<typeof z.json>>;
  /** The record Templates would store. */
  readonly record: z.infer<ReturnType<typeof z.json>>;
  /** The exact pin (kind, ID, version, digest) the preset would get. */
  readonly pin: Pin;
  /** Where the record would be stored. */
  readonly key: RecordKey;
  /** The digests of the uploaded files the preset uses, as text. */
  readonly resources: readonly string[];
  /**
   * The stored records read to prepare it, with their versions (the catalog's revision among them).
   */
  readonly reads: readonly ReadVersion[];
}
/**
 * The codes a resource command can refuse with: Authoring's (selection, theme admission, and the
 * service's own input checks) and Templates' (the catalog, saving presets and reading recipes).
 */
export type ResourceErrorCode = AuthoringErrorCode | TemplatesErrorCode;
/**
 * The mistake a resource command found. It keeps the code and advice of the capability that found
 * it.
 */
export interface ResourceDiagnostic {
  readonly code: ResourceErrorCode;
  /** Where the mistake is, for example `resources` or `preset.kind`. */
  readonly path: string;
  /** A sentence for people. Code never branches on it. */
  readonly message: string;
  /** What the caller should do next. */
  readonly recovery: string;
  /** The capability's own failure, kept as evidence. */
  readonly source?: FailureSource | undefined;
}
/** What a resource command answers: its value, or a `ResourceDiagnostic`. */
export type ResourceResult<T> = Result<T, ResourceDiagnostic>;
