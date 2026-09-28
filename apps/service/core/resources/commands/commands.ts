/*
 * Resource commands: byte staging, lookup and restore through Assets, and the snapshot-bound preset
 * preparation, theme-pin freezing and recipe instantiation the session exposes. Composes the
 * operations; each returns its own typed outcome (refusal.ts). Pure over the injected owners;
 * Assets owns byte recovery, Authoring owns the canonical write and receipt.
 */
import type {
  Assets,
  Catalog,
  Json,
  Language,
  LoweredIntent,
  ResolvedResources,
  Templates,
} from '../../../contract/records/capability-types.js';
import type { ResourceResult } from '../../../contract/records/presets/resource-commands.js';
import type { ResourceCommands, ResourceSelector } from '../../../contract/ports/workspace.js';
import { freeze } from './freeze.js';
import { instantiate } from './instantiate.js';
import { prepare } from './preparation.js';
import { restore } from './restore.js';

/** The owners resource commands work through; compose passes them from ServiceCapabilities and the workspace. */
export interface PresetOwners {
  readonly selector: Pick<ResourceSelector, 'select'>;
  readonly language: Pick<Language, 'print'>;
  readonly assets: Pick<Assets, 'stage' | 'resolve' | 'reserve'>;
  /** Normalises a theme admission against the catalog and the uploaded font bindings. */
  normalize(
    admission: Json,
    catalog: Catalog,
    assets: readonly { readonly alias: string; readonly digest: string }[],
  ): ResourceResult<Json>;
  /** Templates bound to one call's resolved resources. */
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'planAdmission' | 'read' | 'instantiate'>;
}

/**
 * Binds resource commands to their owners; Authoring remains the sole canonical write and receipt
 * gate. `stage`, `blob` and `restore` answer Assets' outcomes (`restore` refuses a malformed body
 * with `invalid-input` at `restore`). `freeze`, `preparePreset` and `instantiate` keep the owner's
 * diagnostic; a malformed input is `invalid-input` at `resources` (`language` for an unprintable
 * recipe, `preset.kind` for a non-recipe pin). Starts no I/O.
 */
export function createResourceCommands(owners: PresetOwners): ResourceCommands {
  return {
    storeUpload: (input) => owners.assets.stage(input),
    readFile: (input) => owners.assets.resolve(input),
    restore: (input) => restore(input, owners),
    freeze: (input, snapshot) => freeze(input, snapshot, owners),
    preparePreset: (input, snapshot) => prepare(input, snapshot, owners),
    instantiate: (input, snapshot) => instantiate(input, snapshot, owners),
  };
}
