/*
 * Why this file exists
 *
 * The routes under `/api/v1/resources/…` need commands behind them. For example,
 * `pnpm canvas theme admit blueprint.theme` first asks `/api/v1/resources/prepare` what saving the
 * theme would store. Other commands store an uploaded font or image, read one back, restore one
 * from a backup, fix a DSL change's themes to exact versions, and turn a recipe into DSL text.
 *
 * This file builds those commands (`ResourceCommands`) from the parts compose passes in. Only
 * upload and restore write, and only file bytes. Authoring saves every change to the workspace.
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
import type { FontBinding } from '../../../contract/ports/headless.js';
import { freezeThemeVersions } from './freeze.js';
import { instantiateRecipe } from './instantiate.js';
import { preparePreset } from './preparation.js';
import { restoreFile } from './restore.js';

/** The parts the resource commands work through. Compose passes them in. */
export interface ResourceCommandDependencies {
  /** Picks the themes and files a request uses (selection/select.ts). */
  readonly selector: Pick<ResourceSelector, 'select'>;
  /** Language's printer, which turns a recipe's collection into DSL text. */
  readonly language: Pick<Language, 'print'>;
  /** The file store: stores uploads, reads files back, and holds a file while it is restored. */
  readonly assets: Pick<Assets, 'stage' | 'resolve' | 'reserve'>;
  /**
   * Translates a theme written in source syntax (hex colours, font names) into the form Templates
   * checks. Anything else comes back unchanged (see core/presets/theme-admission.ts).
   */
  translateTheme(
    preset: Json,
    catalog: Catalog,
    fonts: readonly FontBinding[],
  ): ResourceResult<Json>;
  /** Gives Templates set up with the themes and files one call picked. */
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'planAdmission' | 'read' | 'instantiate'>;
}

/**
 * Builds the resource commands (see `ResourceCommands` for what each one answers). Starts nothing.
 * Upload and read go straight to the file store; the other commands are in this folder.
 */
export function createResourceCommands(
  dependencies: ResourceCommandDependencies,
): ResourceCommands {
  return {
    storeUpload: (input) => dependencies.assets.stage(input),
    readFile: (input) => dependencies.assets.resolve(input),
    restore: (input) => restoreFile(input, dependencies),
    freeze: (input, snapshot) => freezeThemeVersions(input, snapshot, dependencies),
    preparePreset: (input, snapshot) => preparePreset(input, snapshot, dependencies),
    instantiate: (input, snapshot) => instantiateRecipe(input, snapshot, dependencies),
  };
}
