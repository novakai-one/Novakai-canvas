/*
 * The workspace roles every request shares: the checked-contents reader, resource selection,
 * resource commands, render jobs, the render cache and the collection renderer. Bound once per
 * workspace over one Templates binding with no resolved resources. Construction starts no I/O;
 * each role owns its own failures, and Authoring owns commit and recovery.
 */
import type { Assets } from '@novakai/canvas-assets';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { ResourceCommands } from '../records/presets/preparation.js';
import type { ResourceSelector } from '../records/planning/planning.js';
import type { WorkspaceReader } from '../records/workspace/contents.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
import type { CollectionRenderer } from '../ports/collection-renderer.js';
import type { RenderJobs } from '../ports/render-jobs.js';
import type { DiagramProducer } from '../ports/rendering.js';
import { EMPTY_RESOURCES } from '../ports/capabilities.js';
import { createWorkspaceReader } from '../../core/workspace/reader.js';
import { createResourceSelector } from '../../core/resources/selection/select.js';
import { createResourceCommands } from '../../core/resources/commands/commands.js';
import { prepareTheme } from '../../core/presets/theme-admission.js';
import { cacheRenders } from '../../core/rendering/cache.js';
import { createRenderJobs } from '../../core/rendering/jobs.js';
import { createCollectionRenderer } from '../../core/rendering/renderer.js';
import { libavoidWasm } from './producer.js';

/** What the shared roles are built from: the open assets, the installation and the capabilities. */
export interface WorkspaceRoleInputs {
  readonly assets: Assets;
  readonly installation: BuiltinResources;
  readonly resourceRoot: string;
  readonly capabilities: ServiceCapabilities;
  /** The worker-backed producer; the roles render through a cache over it. */
  readonly worker: DiagramProducer;
}

/** The roles one workspace shares between Authoring, the session and the export route. */
export interface WorkspaceRoles {
  readonly views: WorkspaceReader;
  readonly resources: ResourceSelector;
  readonly commands: ResourceCommands;
  readonly jobs: RenderJobs;
  /** The cached producer: feasibility and the renderer share its memo. */
  readonly producer: DiagramProducer;
  readonly renderer: CollectionRenderer;
}

/** Binds the shared roles to one workspace. Never fails; starts no I/O. */
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
    wasmResource: libavoidWasm(inputs.resourceRoot),
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
