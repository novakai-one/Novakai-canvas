import type { FailureSource } from '../transport/failure-source.js';
import type { Result } from '../../errors.js';
import { z } from 'zod';
import type { Assets, Admission, StoredBlob, Result as AssetResult } from '@novakai/canvas-assets';
import type { Request, Snapshot, ReadVersion, RecordKey } from '@novakai/canvas-authoring';
import type { Templates, Pin } from '@novakai/canvas-templates';
import type { Language, LoweredIntent, ResolvedResources } from '@novakai/canvas-language';
import type { ResourceSelector } from '../planning/planning.js';
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
/** Codec construction receives normalized resources; no mutable alias registry survives a call. */
export interface PresetOwners {
  readonly selector: ResourceSelector;
  readonly language: Pick<Language, 'print'>;
  readonly assets: Pick<Assets, 'stage' | 'resolve' | 'reserve'>;
  normalize(
    admission: import('@novakai/canvas-authoring').Json,
    catalog: import('@novakai/canvas-templates').Catalog,
    assets: readonly { readonly alias: string; readonly digest: string }[],
  ): ResourceResult<import('@novakai/canvas-authoring').Json>;
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'planAdmission' | 'read' | 'instantiate'>;
}
