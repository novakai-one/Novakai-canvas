/*
 * The capability rules of one render's environment: the installation's catalog, Language's parse,
 * Model's check, Assets staging and reads, theme admission and base64 decoding. Lowering, drawing
 * and Export are bound by documents.ts, production.ts and exporter.ts; compose joins them. Pure
 * apart from the render's temporary asset store, which it stages into; nothing stored is changed.
 * Every method returns the owner's failure as a value; core/render/render.ts owns recovery.
 */
import { z } from 'zod';
import { validate } from '@novakai/canvas-model';
import type { LoweredIntent } from '@novakai/canvas-language';
import type { BuiltinResources } from '@novakai/canvas-service';
import type { DesignSystem } from '@novakai/canvas-design-system';
import type { Templates } from '@novakai/canvas-templates';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type { ThemeAdmission } from '../../contract/records/theme-source.js';
import type { FontBinding, RenderEnvironment } from '../../contract/ports/render.js';
import type { AssetDigest } from '../../contract/brands.js';
import { faulted, nativeFault, success, type Result } from '../../contract/errors.js';
import type {
  Assets,
  Catalog,
  HeadlessBindings,
  Language,
  StageInput,
} from '../../contract/records/foreign.js';

/** The capability values of one render, over its temporary asset store. */
export interface Environment {
  readonly assets: Pick<Assets, 'stage' | 'resolve'>;
  readonly installation: BuiltinResources;
  readonly system: Pick<DesignSystem, 'resolve' | 'resolveTheme' | 'projectDiagram'>;
  readonly language: Language;
  readonly templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'>;
}

/** The environment methods bound here. */
export type CapabilityRules = Pick<
  RenderEnvironment,
  'catalog' | 'parse' | 'validate' | 'stageAsset' | 'resolveAsset' | 'admitTheme' | 'decodeBase64'
>;

/** The service's theme preparation, which admission runs before Templates plans the theme. */
export type ThemePreparation = Pick<HeadlessBindings, 'prepareTheme'>;

/** The rules over `env`. Builds nothing and cannot fail; each method returns the owner's failure. */
export function createCapabilityRules(
  env: Environment,
  service: ThemePreparation,
): CapabilityRules {
  return {
    catalog: env.installation.presets,
    parse: (source) => env.language.parse(source),
    validate: (value) => validate(value),
    stageAsset: (input) => stagedDigest(env.assets, input),
    resolveAsset: (digest) => env.assets.resolve(digest),
    admitTheme: (catalog, theme, fonts) => admittedTheme(env, service, { catalog, theme, fonts }),
    decodeBase64: (text) => Buffer.from(text, 'base64'),
  };
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
