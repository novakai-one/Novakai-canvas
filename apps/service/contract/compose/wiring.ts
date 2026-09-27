/*
 * Wiring one workspace: every concrete bridge between adapters is bound here, so adapters never
 * import siblings or reach another capability's private implementation. One request's
 * cancellation binds through Authoring and the actual feasibility workers; no global
 * current-request variable is used.
 */
import { composeAuthoring, failure as authoringFailure } from '@novakai/canvas-authoring';
import type {
  Authoring,
  CandidateValidator,
  Request,
  Result as AuthoringResult,
} from '@novakai/canvas-authoring';
import { composeDesignSystem } from '@novakai/canvas-design-system';
import { composeTemplates } from '@novakai/canvas-templates';
import { createLanguage } from '@novakai/canvas-language';
import { validate, plan, stage } from '@novakai/canvas-model';
import type { WorkspaceOptions, NativeWorkspace } from '../records/startup.js';
import type { AdmissionRuntime } from '../records/runtime.js';
import type { BuiltinResources } from '../records/builtins.js';
import type { WorkspaceSession } from '../types.js';
import type { DiagramProducer } from '../ports/rendering.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import { createWorkspaceSession } from '../api.js';
import { createWorkspaceExporter } from '../../adapters/workspace/export.js';
import { createPngRuntime } from '../../adapters/raster/png-runtime.js';
import { cacheRenders } from '../../adapters/rendering/render-cache.js';
import type { createFeasibility } from '../../adapters/planning/feasibility.js';

/** The workspace after wiring: the session facade, its validator, and the startup requests. */
export interface WiredWorkspace {
  adopt(): ReturnType<Authoring['initializeHistory']>;
  readonly session: WorkspaceSession;
  readonly validation: CandidateValidator;
  readonly initialize: AuthoringResult<Request>;
}

/** All concrete bridges are wired here; adapters never import siblings or reach another capability's private implementation. */
export async function wireWorkspace(
  native: NativeWorkspace,
  installation: BuiltinResources,
  options: WorkspaceOptions,
  worker: DiagramProducer,
): Promise<Result<WiredWorkspace>> {
  const producer = cacheRenders(worker);
  const [
    storeModule,
    codecModule,
    viewModule,
    resourceModule,
    leaseModule,
    collectionModule,
    libraryModule,
    plannerModule,
    validationModule,
    jobModule,
    feasibilityModule,
    rendererModule,
    installationModule,
    channelModule,
    lifetimeModule,
    resourceCommandsModule,
    presetPlannerModule,
    themePreparationModule,
  ] = await Promise.all([
    import('../../adapters/storage/authoring-store.js'),
    import('../../adapters/builtins/preset-codecs.js'),
    import('../../adapters/workspace/workspace-reader.js'),
    import('../../adapters/resources/resource-selection.js'),
    import('../../adapters/resources/resource-leases.js'),
    import('../../adapters/planning/collection-plans.js'),
    import('../../adapters/planning/library-planner.js'),
    import('../../adapters/planning/diagram-planners.js'),
    import('../../adapters/planning/candidate-validation.js'),
    import('../../adapters/rendering/render-jobs.js'),
    import('../../adapters/planning/feasibility.js'),
    import('../../adapters/rendering/collection-renderer.js'),
    import('../../adapters/planning/installation-planner.js'),
    import('../../adapters/notifications/change-channel.js'),
    import('../../adapters/runtime/session-lifetime.js'),
    import('../../adapters/resources/resource-commands.js'),
    import('../../adapters/planning/preset-planner.js'),
    import('../../adapters/rendering/theme-preparation.js'),
  ]);
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const system = composeDesignSystem();
  const context = {
    system,
    language,
    sources: installation.tokens,
    resources: { themes: {}, assets: {} },
  };
  const templates = composeTemplates(codecModule.createPresetCodecs(context));
  const views = viewModule.createWorkspaceReader({ templates });
  const resources = resourceModule.createResourceSelector({
    assets: native.assets,
    templates,
    language,
    installation: installation.presets,
  });
  const resourceCommands = resourceCommandsModule.createResourceCommands({
    assets: native.assets,
    selector: resources,
    language,
    normalize: (admission, catalog, bindings) =>
      themePreparationModule.prepareTheme(admission, catalog, bindings, {
        assets: native.assets,
        templates,
      }),
    templates: (resources) =>
      composeTemplates(codecModule.createPresetCodecs({ ...context, resources })),
  });
  const collections = collectionModule.createCollectionPlanner(views, resources);
  const initial = {
    workspace: options.workspace,
    title: options.title,
    createdAt: options.createdAt,
    presets: installation.presets,
  };
  const planners = [
    installationModule.createInstallationPlanner(initial),
    presetPlannerModule.createPresetPlanner(resourceCommands),
    libraryModule.createLibraryPlanner(views),
    ...plannerModule.createDiagramPlanners({ language, workspace: views, resources, collections }),
  ];
  const validation = validationModule.createCandidateValidator({
    workspace: views,
    resources,
    assets: native.assets,
  });
  const jobs = jobModule.createRenderJobs({
    assets: native.assets,
    system,
    sources: installation.tokens,
    templates,
    wasmResource: `${options.resourceRoot}/vendor/layout/libavoid.wasm`,
  });
  const changes = channelModule.createChangeChannel();
  const lifetime = lifetimeModule.createSessionLifetime(async () => {
    changes.close();
    return native.close();
  });
  const runtime = {
    store: storeModule.createAuthoringStore(native.storage),
    planners,
    validation,
    resources: leaseModule.createResourceAdmission(resources, native.assets),
    changes,
    feasibility: { workspace: views, jobs, producer },
  };
  const renderer = rendererModule.createCollectionRenderer({
    assets: native.assets,
    jobs,
    producer,
    resources,
  });
  const exporter = await createWorkspaceExporter({
    workspace: options.workspace,
    installation,
    assets: native.assets,
    language,
    views,
    resources,
    renderer,
    png: createPngRuntime(),
    authoring: (signal) => requestAuthoring(runtime, signal, feasibilityModule.createFeasibility),
  });
  if (!exporter.ok) {
    return failure('unavailable', 'startup', 'Workspace composition failed');
  }
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
    authoring: (signal) => requestAuthoring(runtime, signal, feasibilityModule.createFeasibility),
    renderer,
    exporter: exporter.value.invoke,
  });
  const adopt = () =>
    requestAuthoring(
      runtime,
      new AbortController().signal,
      feasibilityModule.createFeasibility,
    ).initializeHistory(options.workspace);
  return {
    ok: true,
    value: {
      session,
      validation,
      adopt,
      initialize: installationModule.installationRequest(initial),
    },
  };
}

/** Bind one request's cancellation through Authoring and actual feasibility workers; no global current-request variable is used. */
function requestAuthoring(
  runtime: AdmissionRuntime,
  signal: AbortSignal,
  makeFeasibility: typeof createFeasibility,
): Authoring {
  return composeAuthoring({
    ...runtime.store,
    planners: runtime.planners,
    validation: runtime.validation,
    resources: runtime.resources,
    notifications: runtime.changes,
    cancellation: { cancelled: () => signal.aborted },
    feasibility: makeFeasibility({
      ...runtime.feasibility,
      producer: {
        produce: (job) => runtime.feasibility.producer.produce(job, signal),
      },
    }),
  });
}
