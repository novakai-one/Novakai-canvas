/*
 * Why this file exists
 *
 * Authoring, the session and the exporter all need the same workspace parts: read a snapshot into
 * checked contents, pick a request's themes and files, run resource commands, build render jobs,
 * and render a saved collection. They should share one of each, and one render cache.
 *
 * This file builds those shared parts once per workspace. Building them reads no files and starts
 * nothing. Each part keeps its own mistakes.
 */
import type { Assets } from '@novakai/canvas-assets';
import type { LoweredIntent } from '@novakai/canvas-language';
import type { Templates } from '@novakai/canvas-templates';
import type { PreparedBuiltins } from '../records/presets/builtins.js';
import type { ResourceCommands, ResourceSelector, WorkspaceReader } from '../ports/workspace.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
import type { ThemeSavingInputs } from '../ports/headless.js';
import type { CollectionRenderer, DiagramProducer, RenderJobs } from '../ports/rendering.js';
import { EMPTY_RESOURCES } from '../ports/capabilities.js';
import type { HostPath } from '../brands.js';
import { createWorkspaceReader } from '../../core/workspace/reader.js';
import { createResourceSelector } from '../../core/resources/selection/select.js';
import { createResourceCommands } from '../../core/resources/commands/commands.js';
import { prepareTheme } from '../../core/presets/theme-admission.js';
import { cacheRenders } from '../../core/rendering/cache.js';
import { createRenderJobs } from '../../core/rendering/jobs.js';
import { createCollectionRenderer } from '../../core/rendering/renderer.js';
import { libavoidWasmPath } from './producer.js';

/**
 * What the shared parts are built from: the workspace's file store, the built-in resources and the
 * capabilities.
 */
export interface SharedPartInputs {
  readonly assets: Pick<Assets, 'stage' | 'resolve' | 'reserve' | 'acquire'>;
  readonly builtins: Pick<PreparedBuiltins, 'presets' | 'tokens'>;
  readonly resourceRoot: HostPath;
  readonly capabilities: Pick<
    ServiceCapabilities,
    'model' | 'library' | 'language' | 'system' | 'templates'
  >;
  /** The render workers; the shared parts render through a cache in front of them. */
  readonly renderWorkers: DiagramProducer;
}

/** The parts one workspace shares between Authoring, the session and the exporter. */
export interface SharedParts {
  /** Reads a snapshot into `WorkspaceContents`, the checked collections, catalog and presets. */
  readonly reader: WorkspaceReader;
  /** Picks the themes and files a request or collection uses. */
  readonly resources: ResourceSelector;
  /** The commands behind `/api/v1/resources/…`: upload, restore, read files; prepare presets. */
  readonly commands: ResourceCommands;
  /** Builds the render job for one collection. */
  readonly jobs: RenderJobs;
  /** The render workers behind a cache; the layout check and the renderer share it. */
  readonly producer: DiagramProducer;
  /** Renders one saved collection, holding its files until the workers are done. */
  readonly renderer: CollectionRenderer;
}

/** Builds the shared parts for one workspace. Never fails; reads no files. */
export function buildSharedParts(inputs: SharedPartInputs): SharedParts {
  const { model, library } = inputs.capabilities;
  const templates = inputs.capabilities.templates(EMPTY_RESOURCES);
  const producer = cacheRenders(inputs.renderWorkers);
  const reader = createWorkspaceReader({ model, library, templates });
  const resources = resourceSelector(inputs, templates);
  const jobs = renderJobs(inputs, templates);
  const commands = resourceCommands(inputs, resources, templates);
  const renderer = createCollectionRenderer({ assets: inputs.assets, jobs, producer, resources });
  return { reader, resources, commands, jobs, producer, renderer };
}

/** Builds the part that picks the themes and files a request or collection uses. */
function resourceSelector(
  inputs: SharedPartInputs,
  templates: Templates<LoweredIntent>,
): ResourceSelector {
  const { model, language } = inputs.capabilities;
  return createResourceSelector({
    model,
    assets: inputs.assets,
    templates,
    language,
    builtinPresets: inputs.builtins.presets,
  });
}

/** Builds the part that makes one collection's render job. */
function renderJobs(
  inputs: SharedPartInputs,
  templates: Templates<LoweredIntent>,
): RenderJobs {
  const wasmResource = libavoidWasmPath(inputs.resourceRoot);
  return createRenderJobs({
    assets: inputs.assets,
    system: inputs.capabilities.system,
    sources: inputs.builtins.tokens,
    templates,
    wasmResource,
  });
}

/** Builds the commands behind `/api/v1/resources/…`; a theme is readied with `prepareTheme`. */
function resourceCommands(
  inputs: SharedPartInputs,
  selector: ResourceSelector,
  templates: Templates<LoweredIntent>,
): ResourceCommands {
  const themeSaving: ThemeSavingInputs = { assets: inputs.assets, templates };
  return createResourceCommands({
    assets: inputs.assets,
    selector,
    language: inputs.capabilities.language,
    translateTheme: (admission, catalog, bindings) =>
      prepareTheme(admission, catalog, bindings, themeSaving),
    templates: inputs.capabilities.templates,
  });
}
