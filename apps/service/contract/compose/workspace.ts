/*
 * Why this file exists
 *
 * Authoring, the session and the exporter all need the same workspace helpers: read a snapshot
 * into checked contents, pick a request's themes and files, run resource commands, build render
 * jobs, and render a saved collection. They should share one of each, and one render cache.
 *
 * This file builds those shared helpers ("roles") once per workspace. Building them reads no files
 * and starts nothing. Each role keeps its own mistakes.
 */
import type { Assets } from '@novakai/canvas-assets';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { ResourceCommands, ResourceSelector, WorkspaceReader } from '../ports/workspace.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
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
 * What the shared roles are built from: the workspace's file store, the built-in resources and the
 * capabilities.
 */
export interface WorkspaceRoleInputs {
  readonly assets: Pick<Assets, 'stage' | 'resolve' | 'reserve' | 'acquire'>;
  readonly builtins: Pick<BuiltinResources, 'presets' | 'tokens'>;
  readonly resourceRoot: HostPath;
  readonly capabilities: Pick<
    ServiceCapabilities,
    'model' | 'library' | 'language' | 'system' | 'templates'
  >;
  /** The render workers; the roles render through a cache in front of them. */
  readonly renderWorkers: DiagramProducer;
}

/** The roles one workspace shares between Authoring, the session and the exporter. */
export interface WorkspaceRoles {
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

/** Builds the shared roles for one workspace. Never fails; reads no files. */
export function wireWorkspaceRoles(inputs: WorkspaceRoleInputs): WorkspaceRoles {
  const { assets, builtins, capabilities } = inputs;
  const { model, library, language, system } = capabilities;
  const templates = capabilities.templates(EMPTY_RESOURCES);
  const producer = cacheRenders(inputs.renderWorkers);
  const reader = createWorkspaceReader({ model, library, templates });
  const resources = createResourceSelector({
    model,
    assets,
    templates,
    language,
    installation: builtins.presets,
  });
  const jobs = createRenderJobs({
    assets,
    system,
    sources: builtins.tokens,
    templates,
    wasmResource: libavoidWasmPath(inputs.resourceRoot),
  });
  const commands = createResourceCommands({
    assets,
    selector: resources,
    language,
    normalize: (admission, catalog, bindings) =>
      prepareTheme(admission, catalog, bindings, { assets, templates }),
    templates: capabilities.templates,
  });
  const renderer = createCollectionRenderer({ assets, jobs, producer, resources });
  return { reader, resources, commands, jobs, producer, renderer };
}
