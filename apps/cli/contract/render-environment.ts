/*
 * The RenderEnvironment port the render rules in core/render call, bound over one render's
 * prepared capability values and the service's theme preparation. Pure apart from the temporary
 * asset store it stages into; nothing stored is changed. Every method returns the owner's failure
 * as a value; the headless adapter owns recovery.
 */
import { z } from 'zod';
import { validate } from '@novakai/canvas-model';
import { faulted, nativeFault, type RenderEvidence } from './records/render-failure.js';
import type { ThemeAdmission } from './records/theme-source.js';
import type { FontBinding, RenderEnvironment } from './ports/render.js';
import type { AssetDigest } from './brands.js';
import { success, type Result } from './errors.js';
import type {
  Catalog,
  Collection,
  HeadlessBindings,
  Language,
  ResolvedResources,
  StageInput,
} from './records/foreign.js';
import type { Environment } from './render.js';

/** The service binding the port uses: theme preparation only. */
type ThemePreparation = Pick<HeadlessBindings, 'prepareTheme'>;

/**
 * The port the render rules call, over one prepared environment and the service's theme
 * preparation. Every method returns the owner's failure as a value: Language, Model, Assets,
 * the service or Templates.
 */
export function renderEnvironment(
  env: Environment,
  service: ThemePreparation,
): RenderEnvironment {
  return {
    catalog: env.installation.presets,
    parse: (source) => env.language.parse(source),
    lower: (source, resources) => loweredCollection(env.language, source, resources),
    validate: (value) => validate(value),
    stageAsset: (input) => stagedDigest(env.assets, input),
    resolveAsset: (digest) => env.assets.resolve(digest),
    admitTheme: (catalog, theme, fonts) => admittedTheme(env, service, { catalog, theme, fonts }),
    decodeBase64: (text) => Buffer.from(text, 'base64'),
  };
}

/** `source` lowered as a new collection against `resources`. Fails with Language's diagnostics. */
function loweredCollection(
  language: Language,
  source: string,
  resources: ResolvedResources,
): Result<Collection, RenderEvidence> {
  const lowered = language.lower({ source, mode: 'create', snapshot: null, resources });
  if (!lowered.ok) return lowered;
  return success(lowered.value.collection);
}

/** The digest Assets stored `input`'s normalized bytes under. Fails with Assets' failure. */
async function stagedDigest(
  assets: Environment['assets'],
  input: StageInput,
): Promise<Result<AssetDigest, RenderEvidence>> {
  const admitted = await assets.stage(input);
  if (!admitted.ok) return admitted;
  return success(admitted.value.descriptor.digest);
}

/** The service's theme preparation's answer. */
type PreparedTheme = ReturnType<HeadlessBindings['prepareTheme']>;

/** One theme admission's input: the catalog, the theme and its staged fonts. */
interface ThemeInput {
  readonly catalog: Catalog;
  readonly theme: ThemeAdmission;
  readonly fonts: readonly FontBinding[];
}

/**
 * The catalog with the theme admitted through the service's preparation and Templates' plan. A
 * value JSON cannot hold (a dimension too large to be finite) fails as `provider-failed` with the
 * JSON check's message; otherwise fails as the preparation or the plan does.
 */
function admittedTheme(
  env: Environment,
  service: ThemePreparation,
  input: ThemeInput,
): Result<Catalog, RenderEvidence> {
  const admission = z.json().safeParse(input.theme);
  if (!admission.success) return faulted(nativeFault(admission.error));
  const prepared = service.prepareTheme(admission.data, input.catalog, input.fonts, env);
  return plannedTheme(env, input.catalog, prepared);
}

/** The prepared theme planned into the catalog. Fails as the preparation or the plan does. */
function plannedTheme(
  env: Environment,
  catalog: Catalog,
  prepared: PreparedTheme,
): Result<Catalog, RenderEvidence> {
  if (!prepared.ok) return prepared;
  const planned = env.templates.planAdmission(catalog, prepared.value);
  if (!planned.ok) return planned;
  return success(planned.value.candidate);
}
