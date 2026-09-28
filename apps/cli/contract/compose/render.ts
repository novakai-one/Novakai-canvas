/*
 * Why this file exists
 *
 * render:png's core decides what to draw, but it can't touch a file or import the parts that
 * draw. Something must build those parts for real: the file readers, the PNG engine, a throwaway
 * font and image store, Language, the Design System, Templates and the service's layout.
 *
 * This file builds them for one render and hands them over as one bundle of parts, `RenderPorts`.
 * If opening the render's environment (`RenderPorts.open`) fails part way, it closes the store it
 * made. A render never changes a saved collection.
 */
import { join } from 'node:path';
import {
  createHeadlessBindings,
  prepareInstallation,
  validReport,
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
import type { RenderFailureSource } from '../records/render-failure.js';
import type { HeadlessTools, Language } from '../records/foreign.js';
import { renderFaultFailure, nativeFault, success, type Result } from '../errors.js';
import { createLanguageWithModel } from './language.js';
import { createThemeReader } from './theme-reader.js';

/**
 * Builds the bundle of parts one render needs. Rejects (throws) if the service's drawing code
 * can't be loaded; `compose.ts` turns that into `render-unavailable`.
 */
export async function createRenderPorts(request: RenderRequest): Promise<RenderPorts> {
  const service = await createHeadlessBindings();
  return {
    open: () => openEnvironment(request, service),
    inputFiles: createInputFiles(request.root),
    raster: createRaster(request.root),
    sectionFiles: createSectionFiles(request),
    resources: createResourceReader(),
    themeReader: createThemeReader(),
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
  service: HeadlessTools,
): Promise<Result<RenderEnvironment, RenderFailureSource>> {
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
  readonly service: HeadlessTools;
  readonly request: RenderRequest;
  readonly store: TempAssetStore;
}

/**
 * The installation prepared in `store` and the environment port over it. Fails with the service's
 * installation failure.
 */
async function environmentIn(
  request: RenderRequest,
  service: HeadlessTools,
  store: TempAssetStore,
): Promise<Result<RenderEnvironment, RenderFailureSource>> {
  const installation = await prepareInstallation(
    join(request.root, 'resources'),
    join(request.root, 'capability/design-system'),
    store.assets,
  );
  if (!installation.ok) return installation;
  const environment = capabilities(service, store.assets, installation.value);
  return success(environmentPort(environment, { service, request, store }));
}

/** A step that threw instead of returning its failure, as `provider-failed` with its evidence. */
function thrown(error: unknown): Result<never, RenderFailureSource> {
  return renderFaultFailure(nativeFault(error));
}

/** `error` as the outcome once `store` is closed; a failed close is not reported over it. */
async function closedAfter(
  store: TempAssetStore,
  error: RenderFailureSource,
): Promise<Result<never, RenderFailureSource>> {
  await store.close();
  return { ok: false, error };
}

/** Language, the Design System and Templates over the installation's tokens. Cannot fail. */
function capabilities(
  service: HeadlessTools,
  assets: TempAssetStore['assets'],
  installation: BuiltinResources,
): Environment {
  const system = composeDesignSystem();
  const language = createLanguageWithModel();
  const codecs = service.createPresetCodecs({
    system,
    language,
    sources: installation.tokens,
    resources: { themes: {}, assets: {} },
  });
  return { assets, installation, system, language, templates: composeTemplates(codecs) };
}

/**
 * The environment port over `environment`, joined from the render adapters: sources, assets,
 * themes and output. Closing it closes the store. Cannot fail.
 */
function environmentPort(
  environment: Environment,
  owners: PortOwners,
): RenderEnvironment {
  return {
    sources: createRenderSources(environment.language),
    assets: createRenderAssets(environment.assets),
    themes: createRenderThemes({
      presets: environment.installation.presets,
      assets: environment.assets,
      templates: environment.templates,
      prepareTheme: owners.service.prepareTheme,
    }),
    output: renderOutput(environment, owners),
    close: () => owners.store.close(),
  };
}

/** The output port: the service's drawing and Export, each from its own adapter. */
function renderOutput(
  environment: Environment,
  owners: PortOwners,
): RenderOutput {
  return {
    ...createProduction(serviceProduction(environment, owners)),
    ...createExporter(exportChoices(environment, owners.request)),
  };
}

/**
 * The service's render jobs over `environment`, with the layout engine's wasm below the repo root,
 * and the service's inspection report of a rendered document.
 */
function serviceProduction(
  environment: Environment,
  owners: PortOwners,
): Production {
  const jobs = owners.service.createRenderJobs({
    ...environment,
    sources: environment.installation.tokens,
    wasmResource: join(owners.request.root, 'resources/vendor/layout/libavoid.wasm'),
  });
  return { jobs, produceDiagram: owners.service.produceDiagram, inspectDocument: validReport };
}

/** The request's format and label mode, and Export's documents port over Language. */
function exportChoices(
  environment: Environment,
  request: RenderRequest,
): ExportChoices {
  return {
    format: request.format,
    labels: request.labels,
    documentsFor: (pins) => exportDocuments(environment.language, pins),
  };
}
