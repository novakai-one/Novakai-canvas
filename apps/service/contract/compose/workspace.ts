/*
 * Why this file exists
 *
 * Authoring, the session and the export route all need the same workspace helpers: read a snapshot
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
 * What the shared roles are built from: the open files store, the installation and the
 * capabilities.
 */
export interface WorkspaceRoleInputs {
  readonly assets: Pick<Assets, 'stage' | 'resolve' | 'reserve' | 'acquire'>;
  readonly installation: Pick<BuiltinResources, 'presets' | 'tokens'>;
  readonly resourceRoot: HostPath;
  readonly capabilities: Pick<
    ServiceCapabilities,
    'model' | 'library' | 'language' | 'system' | 'templates'
  >;
  /** The render worker pool; the roles render through a cache in front of it. */
  readonly worker: DiagramProducer;
}

/** The roles one workspace shares between Authoring, the session and the export route. */
export interface WorkspaceRoles {
  /** Reads a snapshot into checked contents. */
  readonly views: WorkspaceReader;
  /** Picks the themes and files a request or collection uses. */
  readonly resources: ResourceSelector;
  readonly commands: ResourceCommands;
  readonly jobs: RenderJobs;
  /** The cached producer: feasibility and the renderer share its memo. */
  readonly producer: DiagramProducer;
  readonly renderer: CollectionRenderer;
}

/** Builds the shared roles for one workspace. Never fails; reads no files. */
export function wireWorkspaceRoles(inputs: WorkspaceRoleInputs): WorkspaceRoles {
  const { assets, installation, capabilities } = inputs;
  const { model, library, language, system } = capabilities;
  const templates = capabilities.templates(EMPTY_RESOURCES);
  const producer = cacheRenders(inputs.worker);
  const views = createWorkspaceReader({ model, library, templates });
  const resources = createResourceSelector({
    model,
    assets,
    templates,
    language,
    installation: installation.presets,
  });
  const jobs = createRenderJobs({
    assets,
    system,
    sources: installation.tokens,
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
  return { views, resources, commands, jobs, producer, renderer };
}
