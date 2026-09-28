/*
 * `pnpm render:png` wiring: builds the ports of one read-only render and injects them. The
 * service's headless bindings, the resource reader and the render's input files, raster engine and
 * section files are built once; `open` makes the render's temporary asset store, prepares the
 * installation in it, builds Language, the Design System and Templates over it, and joins the
 * environment's sources, assets, themes and output ports from the adapters in adapters/render/.
 * Not pure: the adapters touch the filesystem. Failures are values, and a failed `open` closes the
 * store it made; a render changes nothing stored, so the caller fixes the input and runs it again.
 */
import { join } from 'node:path';
import {
  createHeadlessBindings,
  prepareInstallation,
  type BuiltinResources,
} from '@novakai/canvas-service';
import { composeDesignSystem, type DesignSystem } from '@novakai/canvas-design-system';
import type { LoweredIntent } from '@novakai/canvas-language';
import { composeTemplates, type Templates } from '@novakai/canvas-templates';
import { createResourceReader } from '../../adapters/files/resource-reader.js';
import { createRenderAssets } from '../../adapters/render/assets.js';
import { createExporter, type ExportChoices } from '../../adapters/render/exporter.js';
import { createProduction, type Production } from '../../adapters/render/production.js';
import { createRaster } from '../../adapters/render/raster.js';
import { createInputFiles, createSectionFiles } from '../../adapters/render/render-files.js';
import { createRenderSources, exportDocuments } from '../../adapters/render/sources.js';
import { openTempAssets } from '../../adapters/render/temp-assets.js';
import { createRenderThemes } from '../../adapters/render/themes.js';
import type { RenderEnvironment, RenderPorts } from '../ports/render.js';
import type { TempAssetStore } from '../ports/render-assets.js';
import type { RenderOutput } from '../ports/render-output.js';
import type { RenderRequest } from '../records/render.js';
import type { RenderEvidence } from '../records/render-failure.js';
import type { HeadlessBindings, Language } from '../records/foreign.js';
import { faulted, nativeFault, success, type Result } from '../errors.js';
import { composeLanguage } from './language.js';

/**
 * The ports of one render. Rejects when the service's render adapters cannot be imported; the
 * composition root reports that as `render-unavailable`.
 */
export async function renderPorts(request: RenderRequest): Promise<RenderPorts> {
  const service = await createHeadlessBindings();
  return {
    open: () => openEnvironment(request, service),
    inputFiles: createInputFiles(request.root),
    raster: createRaster(request.root),
    sectionFiles: createSectionFiles(request),
    resources: createResourceReader(),
  };
}

/**
 * The render's temporary asset store and the environment over it. Fails with `provider-failed`
 * or Assets' failure when the store cannot be made. After that, fails as {@link environmentIn}
 * does, or with `provider-failed` when one of its steps throws; the store is then closed and the
 * first failure wins.
 */
async function openEnvironment(
  request: RenderRequest,
  service: HeadlessBindings,
): Promise<Result<RenderEnvironment, RenderEvidence>> {
  const store = await openTempAssets();
  if (!store.ok) return store;
  const environment = await environmentIn(request, service, store.value).catch(thrown);
  if (!environment.ok) return closedAfter(store.value, environment.error);
  return environment;
}

/** The capability values of one render, over its temporary asset store. */
interface Environment {
  readonly assets: TempAssetStore['assets'];
  readonly installation: BuiltinResources;
  readonly system: Pick<DesignSystem, 'resolve' | 'resolveTheme' | 'projectDiagram'>;
  readonly language: Language;
  readonly templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'>;
}

/** What the environment port is joined from besides the capability values. */
interface PortOwners {
  readonly service: HeadlessBindings;
  readonly request: RenderRequest;
  readonly store: TempAssetStore;
}

/**
 * The installation prepared in `store` and the environment port over it. Fails with the service's
 * installation failure.
 */
async function environmentIn(
  request: RenderRequest,
  service: HeadlessBindings,
  store: TempAssetStore,
): Promise<Result<RenderEnvironment, RenderEvidence>> {
  const installation = await prepareInstallation(
    join(request.root, 'resources'),
    join(request.root, 'capability/design-system'),
    store.assets,
  );
  if (!installation.ok) return installation;
  const env = capabilities(service, store.assets, installation.value);
  return success(environmentPort(env, { service, request, store }));
}

/** A step that threw instead of returning its failure, as `provider-failed` with its evidence. */
function thrown(error: unknown): Result<never, RenderEvidence> {
  return faulted(nativeFault(error));
}

/** `error` as the outcome once `store` is closed; a failed close is not reported over it. */
async function closedAfter(
  store: TempAssetStore,
  error: RenderEvidence,
): Promise<Result<never, RenderEvidence>> {
  await store.close();
  return { ok: false, error };
}

/** Language, the Design System and Templates over the installation's tokens. Cannot fail. */
function capabilities(
  service: HeadlessBindings,
  assets: TempAssetStore['assets'],
  installation: BuiltinResources,
): Environment {
  const system = composeDesignSystem();
  const language = composeLanguage();
  const codecs = service.createPresetCodecs({
    system,
    language,
    sources: installation.tokens,
    resources: { themes: {}, assets: {} },
  });
  return { assets, installation, system, language, templates: composeTemplates(codecs) };
}

/**
 * The environment port over `env`, joined from the render adapters: sources, assets, themes and
 * output. Closing it closes the store. Cannot fail.
 */
function environmentPort(
  env: Environment,
  owners: PortOwners,
): RenderEnvironment {
  return {
    sources: createRenderSources(env.language),
    assets: createRenderAssets(env.assets),
    themes: createRenderThemes({
      presets: env.installation.presets,
      assets: env.assets,
      templates: env.templates,
      prepareTheme: owners.service.prepareTheme,
    }),
    output: renderOutput(env, owners),
    close: () => owners.store.close(),
  };
}

/** The output port: the service's drawing and Export, each from its own adapter. */
function renderOutput(
  env: Environment,
  owners: PortOwners,
): RenderOutput {
  return {
    ...createProduction(serviceProduction(env, owners)),
    ...createExporter(exportChoices(env, owners.request)),
  };
}

/** The service's render jobs over `env`, with the layout engine's wasm below the repo root. */
function serviceProduction(
  env: Environment,
  owners: PortOwners,
): Production {
  const jobs = owners.service.createRenderJobs({
    ...env,
    sources: env.installation.tokens,
    wasmResource: join(owners.request.root, 'resources/vendor/layout/libavoid.wasm'),
  });
  return { jobs, produceDiagram: owners.service.produceDiagram };
}

/** The request's format and label mode, and Export's documents port over Language. */
function exportChoices(
  env: Environment,
  request: RenderRequest,
): ExportChoices {
  return {
    format: request.format,
    labels: request.labels,
    documentsFor: (pins) => exportDocuments(env.language, pins),
  };
}
