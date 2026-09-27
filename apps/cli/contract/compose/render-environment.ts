/*
 * The RenderEnvironment port core/render calls, bound over one render's capability values, the
 * service's headless render bindings and the render's temporary asset store. Language, Model,
 * Assets and theme admission are bound here; the service's drawing is in render-production.ts and
 * Export in render-export.ts. Pure apart from that store, which it stages into and closes; nothing
 * stored is changed. Every method returns the owner's failure as a value; core/render/render.ts
 * owns recovery.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { validate } from '@novakai/canvas-model';
import type { LoweredIntent } from '@novakai/canvas-language';
import type { BuiltinResources } from '@novakai/canvas-service';
import type { DesignSystem } from '@novakai/canvas-design-system';
import type { Templates } from '@novakai/canvas-templates';
import { faulted, nativeFault, type RenderEvidence } from '../records/render-failure.js';
import type { RenderRequest } from '../records/render.js';
import type { ThemeAdmission } from '../records/theme-source.js';
import type { FontBinding, RenderEnvironment, TempAssetStore } from '../ports/render.js';
import type { AssetDigest } from '../brands.js';
import { success, type Result } from '../errors.js';
import type {
  Assets,
  Catalog,
  HeadlessBindings,
  Language,
  StageInput,
} from '../records/foreign.js';
import { lowerAsNew } from './language.js';
import { openExporter } from './render-export.js';
import { producedDiagram, type Production } from './render-production.js';

/** The capability values of one render, over its temporary asset store. */
export interface Environment {
  readonly assets: Pick<Assets, 'stage' | 'resolve'>;
  readonly installation: BuiltinResources;
  readonly system: Pick<DesignSystem, 'resolve' | 'resolveTheme' | 'projectDiagram'>;
  readonly language: Language;
  readonly templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'>;
}

/** What the port binds besides the capability values. */
export interface RenderOwners {
  /** Theme preparation, render jobs and the diagram producer. */
  readonly service: Pick<HeadlessBindings, 'prepareTheme' | 'createRenderJobs' | 'produceDiagram'>;
  /** The repo root (the layout wasm), the section format and the label mode. */
  readonly request: Pick<RenderRequest, 'root' | 'format' | 'labels'>;
  readonly store: Pick<TempAssetStore, 'close'>;
}

/** The port core calls. Every method returns the owner's failure as a value. */
export function renderEnvironment(
  env: Environment,
  owners: RenderOwners,
): RenderEnvironment {
  const production = serviceProduction(env, owners);
  return {
    catalog: env.installation.presets,
    parse: (source) => env.language.parse(source),
    lower: (source, resources) => lowerAsNew(env.language, source, resources),
    validate: (value) => validate(value),
    stageAsset: (input) => stagedDigest(env.assets, input),
    resolveAsset: (digest) => env.assets.resolve(digest),
    admitTheme: (catalog, theme, fonts) => admittedTheme(env, owners, { catalog, theme, fonts }),
    produce: (collection, catalog) => producedDiagram(production, collection, catalog),
    exporter: (input) =>
      openExporter(input, {
        format: owners.request.format,
        labels: owners.request.labels,
        language: env.language,
      }),
    decodeBase64: (text) => Buffer.from(text, 'base64'),
    close: () => owners.store.close(),
  };
}

/** The service's render jobs over `env`, with the layout engine's wasm below the repo root. */
function serviceProduction(
  env: Environment,
  owners: RenderOwners,
): Production {
  const jobs = owners.service.createRenderJobs({
    ...env,
    sources: env.installation.tokens,
    wasmResource: join(owners.request.root, 'resources/vendor/layout/libavoid.wasm'),
  });
  return { jobs, produceDiagram: owners.service.produceDiagram };
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
  owners: RenderOwners,
  input: ThemeInput,
): Result<Catalog, RenderEvidence> {
  const admission = z.json().safeParse(input.theme);
  if (!admission.success) return faulted(nativeFault(admission.error));
  const prepared = owners.service.prepareTheme(admission.data, input.catalog, input.fonts, env);
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
