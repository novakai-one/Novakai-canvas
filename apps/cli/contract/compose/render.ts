/*
 * Why this file exists
 *
 * render:png's core decides what to draw, but it can't touch a file or import the parts that
 * draw. Something must build those parts for real: the file readers, the PNG engine, a throwaway
 * font and image store, Language, the Design System, Templates and the service's layout.
 *
 * This file builds them for one render and hands them over as one bundle of parts, `RenderPorts`.
 * The parts that share the throwaway store are opened fresh for each render (`RenderPorts.open`);
 * if that fails part way, the store is closed again. A render never changes a saved collection.
 */
import { join } from 'node:path';
import {
  createHeadlessBindings,
  hostPath,
  prepareBuiltins,
  validReport,
  type PreparedBuiltins,
} from '@novakai/canvas-service';
import { composeDesignSystem, type DesignSystem } from '@novakai/canvas-design-system';
import type { LoweredIntent } from '@novakai/canvas-language';
import { composeTemplates, type Templates } from '@novakai/canvas-templates';
import { createResourceReader } from '../../adapters/files/resource-reader.js';
import { createRenderAssets } from '../../adapters/render/assets.js';
import { createExporter, type ExportChoices } from '../../adapters/render/exporter.js';
import { createServiceLayout, type ServiceLayoutTools } from '../../adapters/render/production.js';
import { createRasterEngine } from '../../adapters/render/raster.js';
import { createInputFiles, createSectionFiles } from '../../adapters/render/render-files.js';
import { createExportDocuments, createRenderSources } from '../../adapters/render/sources.js';
import { openTempAssetStore } from '../../adapters/render/temp-assets.js';
import { createRenderThemes } from '../../adapters/render/themes.js';
import type { RenderEnvironment, RenderPorts } from '../ports/render.js';
import type { TempAssetStore } from '../ports/render-assets.js';
import type { RenderOutput } from '../ports/render-output.js';
import type { RenderRequest } from '../records/render.js';
import type { RenderFailureSource } from '../records/render-failure.js';
import type { HeadlessTools, Language } from '../records/foreign.js';
import { providerFailure, success, type Failure, type Result } from '../errors.js';
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
    raster: createRasterEngine(request.root),
    sectionFiles: createSectionFiles(request),
    resources: createResourceReader(),
    themeReader: createThemeReader(),
  };
}

/**
 * Opens the render's throwaway font and image store, then prepares everything the render draws
 * with over it. Fails with `provider-failed` or Assets' failure when the store can't be opened.
 * After that it fails as {@link prepareEnvironment} does, or with `provider-failed` when a step
 * throws; the store is then closed and that first failure is the one given back.
 */
async function openEnvironment(
  request: RenderRequest,
  service: HeadlessTools,
): Promise<Result<RenderEnvironment, RenderFailureSource>> {
  const store = await openTempAssetStore();
  if (!store.ok) {
    return store;
  }
  const environment = await prepareEnvironmentOrFault(request, service, store.value);
  if (!environment.ok) {
    return closeStoreAfterFailure(store.value, environment);
  }
  return environment;
}

/** Language, the Design System, Templates and the shipped files one render draws with. */
interface RenderCapabilities {
  readonly assets: TempAssetStore['assets'];
  readonly installation: PreparedBuiltins;
  readonly system: Pick<DesignSystem, 'resolve' | 'resolveTheme' | 'projectDiagram'>;
  readonly language: Language;
  readonly templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'>;
}

/** One render's request, the service's drawing tools, and the render's throwaway store. */
interface RenderSetup {
  readonly service: HeadlessTools;
  readonly request: RenderRequest;
  readonly store: TempAssetStore;
}

/** Prepares the render's environment, turning a throw into `provider-failed` with its details. */
async function prepareEnvironmentOrFault(
  request: RenderRequest,
  service: HeadlessTools,
  store: TempAssetStore,
): Promise<Result<RenderEnvironment, RenderFailureSource>> {
  try {
    return await prepareEnvironment(request, service, store);
  } catch (thrown) {
    return providerFailure(thrown);
  }
}

/**
 * Prepares the shipped resources and design tokens with the store, then joins the render's parts
 * over them. Fails with the service's failure when the shipped resources can't be prepared.
 */
async function prepareEnvironment(
  request: RenderRequest,
  service: HeadlessTools,
  store: TempAssetStore,
): Promise<Result<RenderEnvironment, RenderFailureSource>> {
  const installation = await prepareBuiltins(
    hostPath.parse(join(request.root, 'resources')),
    hostPath.parse(join(request.root, 'capability/design-system')),
    store.assets,
  );
  if (!installation.ok) {
    return installation;
  }
  const capabilities = composeCapabilities(service, store.assets, installation.value);
  const environment = createEnvironmentPort(capabilities, { service, request, store });
  return success(environment);
}

/**
 * Closes the store after a failed step, then gives that failure back unchanged. A failed close
 * isn't reported over it.
 */
async function closeStoreAfterFailure(
  store: TempAssetStore,
  failed: Failure<RenderFailureSource>,
): Promise<Failure<RenderFailureSource>> {
  await store.close();
  return failed;
}

/** Makes Language, the Design System and Templates over the shipped design tokens. Never fails. */
function composeCapabilities(
  service: HeadlessTools,
  assets: TempAssetStore['assets'],
  installation: PreparedBuiltins,
): RenderCapabilities {
  const system = composeDesignSystem();
  const language = createLanguageWithModel();
  const codecs = service.createPresetCodecs({
    system,
    language,
    sources: installation.tokens,
    resources: { themes: {}, assets: {} },
  });
  const templates = composeTemplates(codecs);
  return { assets, installation, system, language, templates };
}

/**
 * Joins the render adapters (sources, assets, themes and output) into the environment the render
 * uses. Closing it closes the store. Never fails.
 */
function createEnvironmentPort(
  capabilities: RenderCapabilities,
  setup: RenderSetup,
): RenderEnvironment {
  return {
    sources: createRenderSources(capabilities.language),
    assets: createRenderAssets(capabilities.assets),
    themes: createRenderThemes({
      presets: capabilities.installation.presets,
      assets: capabilities.assets,
      templates: capabilities.templates,
      prepareTheme: setup.service.prepareTheme,
    }),
    output: createRenderOutput(capabilities, setup),
    close: () => setup.store.close(),
  };
}

/** Joins the service's drawing and Export's image writing into the render's output. */
function createRenderOutput(
  capabilities: RenderCapabilities,
  setup: RenderSetup,
): RenderOutput {
  const layoutTools = createLayoutTools(capabilities, setup);
  const exportChoices = createExportChoices(capabilities, setup.request);
  return { ...createServiceLayout(layoutTools), ...createExporter(exportChoices) };
}

/**
 * Gives the service's render jobs, with the layout engine's wasm file below the repo folder, and
 * the service's check of a drawn document.
 */
function createLayoutTools(
  capabilities: RenderCapabilities,
  setup: RenderSetup,
): ServiceLayoutTools {
  const wasmResource = hostPath.parse(
    join(setup.request.root, 'resources/vendor/layout/libavoid.wasm'),
  );
  const renderJobs = setup.service.createRenderJobs({
    ...capabilities,
    sources: capabilities.installation.tokens,
    wasmResource,
  });
  return {
    renderJobs,
    produceDiagram: setup.service.produceDiagram,
    inspectDocument: validReport,
  };
}

/** Gives the typed image format and label choice, and how Export reads each section's source. */
function createExportChoices(
  capabilities: RenderCapabilities,
  request: RenderRequest,
): ExportChoices {
  return {
    format: request.format,
    labels: request.labels,
    documentsFor: (pins) => createExportDocuments(capabilities.language, pins),
  };
}
