/*
 * Preset preparation records: the request schemas resource commands decode, the prepared preset
 * the preset planner carries, and the ResourceCommands the session exposes. Declarations only;
 * Templates and Assets own their failures, Authoring owns commit and replay.
 */
import type { FailureSource } from '../transport/failure-source.js';
import type { Result } from '../../errors.js';
import { z } from 'zod';
import type { Admission, StoredBlob, Result as AssetResult } from '@novakai/canvas-assets';
import type { Request, Snapshot, ReadVersion, RecordKey } from '@novakai/canvas-authoring';
import type { Pin } from '@novakai/canvas-templates';
/** A preset preparation request: the admission and the uploaded assets it may bind (none by default). */
export const preparationInput = z.strictObject({
  admission: z.json(),
  assets: z.array(z.strictObject({ alias: z.string(), digest: z.string() })).default([]),
});
export type PreparationInput = z.infer<typeof preparationInput>;
/** A byte restore request: the digest and its normalized base64 bytes. */
export const restoreInput = z.strictObject({ digest: z.string(), base64: z.string() });
export type RestoreInput = z.infer<typeof restoreInput>;
/** A recipe instantiation request: the recipe pin (Templates checks it) and the target namespace. */
export const instantiateInput = z.strictObject({ pin: z.unknown(), namespace: z.string() });
/** A retained admission read as named fields, so a recipe's canonical source can replace its own. */
export const admissionFields = z.record(z.string(), z.json());
/** Prepared content is immutable host data; Authoring repeats preparation and owns commit/replay. */
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
/** Preparation returns the exact content and observed catalog revision, without a canonical write. */
export interface PresetPreparation {
  readonly admission: z.infer<ReturnType<typeof z.json>>;
  readonly record: z.infer<ReturnType<typeof z.json>>;
  readonly pin: Pin;
  readonly key: RecordKey;
  readonly resources: readonly string[];
  readonly reads: readonly ReadVersion[];
}
/** Resource preparation preserves the originating owner's stable diagnostic and recovery advice. */
export interface ResourceDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly recovery: string;
  readonly source?: FailureSource | undefined;
}
export type ResourceResult<T> = Result<T, ResourceDiagnostic>;
/** Byte operations remain Assets-owned; semantic operations bind one explicit snapshot. */
export interface ResourceCommands {
  stage(input: unknown): Promise<AssetResult<Admission>>;
  restore(input: unknown): Promise<AssetResult<void>>;
  blob(input: unknown): AssetResult<StoredBlob>;
  freeze(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<Request>;
  preparePreset(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<PresetPreparation>;
  instantiate(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<string>;
}
