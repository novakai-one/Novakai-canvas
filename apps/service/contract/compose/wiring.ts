/*
 * Wiring one workspace: every concrete bridge between adapters is bound here, so adapters never
 * import siblings or reach another capability's private implementation. One request's
 * cancellation binds through Authoring and the actual feasibility workers; no global
 * current-request variable is used.
 */
import { composeAuthoring } from '@novakai/canvas-authoring';
import { createReactBindings } from '@novakai/canvas-presentation';
import type {
  Authoring,
  CandidateValidator,
  Request,
  Result as AuthoringResult,
} from '@novakai/canvas-authoring';
import type { WorkspaceOptions, NativeWorkspace } from '../records/workspace/startup.js';
import type { AdmissionRuntime } from '../records/workspace/runtime.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { WorkspaceSession } from '../types.js';
import type { DiagramProducer } from '../ports/rendering.js';
import { EMPTY_RESOURCES } from '../ports/capabilities.js';
import type { Result } from '../errors.js';
import { authoringFailure, failure, success } from '../errors.js';
import { createWorkspaceSession } from '../../core/session/facade.js';
import { createSessionLifetime } from '../../core/session/lifetime.js';
import { createWorkspaceReader } from '../../core/workspace/reader.js';
import { createResourceSelector } from '../../core/resources/selection/select.js';
import { createResourceCommands } from '../../core/resources/commands/commands.js';
import { createResourceAdmission } from '../../core/authoring-roles/resource-leases.js';
import { createFeasibility } from '../../core/authoring-roles/feasibility.js';
import { createCandidateValidator } from '../../core/authoring-roles/validation/candidate.js';
import {
  createInstallationPlanner,
  installationRequest,
} from '../../core/authoring-roles/planners/bootstrap.js';
import { createCollectionPlanner } from '../../core/authoring-roles/planners/collection-proposal.js';
import { createDiagramPlanners } from '../../core/authoring-roles/planners/dsl.js';
import { createLibraryPlanner } from '../../core/authoring-roles/planners/library.js';
import { createPresetPlanner } from '../../core/authoring-roles/planners/preset.js';
import { prepareTheme } from '../../core/presets/theme-admission.js';
import { createExportRoute } from '../../core/export/route.js';
import { createPngRuntime } from '../../adapters/raster/png-runtime.js';
import { cacheRenders } from '../../core/rendering/cache.js';
import { createRenderJobs } from '../../core/rendering/jobs.js';
import { createCollectionRenderer } from '../../core/rendering/renderer.js';
import { createServiceCapabilities } from './capabilities.js';

/** The workspace after wiring: the session facade, its validator, and the startup requests. */
export interface WiredWorkspace {
  adopt(): ReturnType<Authoring['initializeHistory']>;
  readonly session: WorkspaceSession;
  readonly validation: CandidateValidator;
  readonly initialize: AuthoringResult<Request>;
}

/**
 * Wire one workspace's adapters, core and capabilities into its session facade. Fails with
 * `unavailable` at `startup` ("Workspace composition failed") when the Presentation bindings
 * cannot be created from the installation fonts. A rejected adapter import reaches `startOpened`
 * in startup.ts, which answers the same failure and closes the native handles.
 */
export async function wireWorkspace(
  native: NativeWorkspace,
  installation: BuiltinResources,
  options: WorkspaceOptions,
  worker: DiagramProducer,
): Promise<Result<WiredWorkspace>> {
  const producer = cacheRenders(worker);
  const [storeModule, channelModule] = await Promise.all([
    import('../../adapters/storage/authoring-store.js'),
    import('../../adapters/notifications/change-channel.js'),
  ]);
  const capabilities = createServiceCapabilities(installation.tokens);
  const { language, system, model, library } = capabilities;
  const templates = capabilities.templates(EMPTY_RESOURCES);
  const views = createWorkspaceReader({ model, library, templates });
  const resources = createResourceSelector({
    model,
    assets: native.assets,
    templates,
    language,
    installation: installation.presets,
  });
  const resourceCommands = createResourceCommands({
    assets: native.assets,
    selector: resources,
    language,
    normalize: (admission, catalog, bindings) =>
      prepareTheme(admission, catalog, bindings, {
        assets: native.assets,
        templates,
      }),
    templates: capabilities.templates,
  });
  const collections = createCollectionPlanner({ library, workspace: views, resources });
  const initial = {
    workspace: options.workspace,
    title: options.title,
    createdAt: options.createdAt,
    presets: installation.presets,
  };
  const planners = [
    createInstallationPlanner(initial),
    createPresetPlanner(resourceCommands),
    createLibraryPlanner({ library, workspace: views }),
    ...createDiagramPlanners({ model, language, workspace: views, resources, collections }),
  ];
  const validation = createCandidateValidator({
    workspace: views,
    resources,
    assets: native.assets,
  });
  const jobs = createRenderJobs({
    assets: native.assets,
    system,
    sources: installation.tokens,
    templates,
    wasmResource: `${options.resourceRoot}/vendor/layout/libavoid.wasm`,
  });
  const changes = channelModule.createChangeChannel();
  const lifetime = createSessionLifetime(async () => {
    changes.close();
    return native.close();
  });
  const runtime = {
    store: storeModule.createAuthoringStore(native.storage),
    planners,
    validation,
    resources: createResourceAdmission(resources, native.assets),
    changes,
    feasibility: { workspace: views, jobs, producer },
  };
  const renderer = createCollectionRenderer({
    assets: native.assets,
    jobs,
    producer,
    resources,
  });
  const presentation = await createReactBindings(installation.fonts);
  if (!presentation.ok) {
    return failure('unavailable', 'startup', 'Workspace composition failed');
  }
  const exporter = createExportRoute({
    workspace: options.workspace,
    model,
    language,
    export: capabilities.export,
    presentation: presentation.value,
    assets: native.assets,
    views,
    resources,
    renderer,
    png: createPngRuntime(),
    authoring: (signal) => requestAuthoring(runtime, signal),
  });
  const session = createWorkspaceSession({
    workspace: options.workspace,
    installation,
    resources: resourceCommands,
    views,
    changes,
    lifetime,
    readSignal: new AbortController().signal,
    unavailable: () =>
      authoringFailure('storage-unavailable', 'session', 'Workspace is closing or closed'),
    authoring: (signal) => requestAuthoring(runtime, signal),
    renderer,
    exporter: exporter.invoke,
  });
  const adopt = () =>
    requestAuthoring(runtime, new AbortController().signal).initializeHistory(options.workspace);
  return success({
    session,
    validation,
    adopt,
    initialize: installationRequest(initial),
  });
}

/** Bind one request's cancellation through Authoring and actual feasibility workers; no global current-request variable is used. */
function requestAuthoring(
  runtime: AdmissionRuntime,
  signal: AbortSignal,
): Authoring {
  return composeAuthoring({
    ...runtime.store,
    planners: runtime.planners,
    validation: runtime.validation,
    resources: runtime.resources,
    notifications: runtime.changes,
    cancellation: { cancelled: () => signal.aborted },
    feasibility: createFeasibility({
      ...runtime.feasibility,
      producer: {
        produce: (job) => runtime.feasibility.producer.produce(job, signal),
      },
    }),
  });
}
