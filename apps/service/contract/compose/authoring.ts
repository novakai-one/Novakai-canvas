/*
 * Why this file exists
 *
 * Authoring decides whether a change is saved, but it needs the service's help: storage, planners
 * that turn DSL or Model changes into writes, checks, file holds, change announcements, and a
 * check that the result can be laid out. If a request is cancelled, only that request's renders
 * should stop.
 *
 * This file builds those helpers once per workspace, and makes a fresh Authoring for each request
 * with that request's signal. Authoring itself saves the change and writes the receipt.
 */
import { composeAuthoring } from '@novakai/canvas-authoring';
import type { Assets } from '@novakai/canvas-assets';
import type {
  Authoring,
  CandidateValidator,
  HistoryStatus,
  IntentPlanner,
  Notifications,
  Request,
  ResourceAdmission,
  Result as AuthoringResult,
} from '@novakai/canvas-authoring';
import type { NewWorkspaceSeed, WorkspaceOptions } from '../records/workspace/startup.js';
import type { PreparedBuiltins } from '../records/presets/builtins.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
import type { AuthoringStore, ConditionalStorage } from '../ports/storage.js';
import { createResourceAdmission } from '../../core/authoring-roles/resource-leases.js';
import {
  createFeasibility,
  type FeasibilityDependencies,
} from '../../core/authoring-roles/feasibility.js';
import { createCandidateValidator } from '../../core/authoring-roles/validation/candidate.js';
import {
  createBootstrapPlanner,
  buildSeedRequest,
} from '../../core/authoring-roles/planners/bootstrap.js';
import { createCollectionPlanner } from '../../core/authoring-roles/planners/collection-proposal.js';
import { createDslPlanner } from '../../core/authoring-roles/planners/dsl.js';
import { createModelPlanner } from '../../core/authoring-roles/planners/model.js';
import { createLibraryPlanner } from '../../core/authoring-roles/planners/library.js';
import { createPresetPlanner } from '../../core/authoring-roles/planners/preset.js';
import type { SharedParts } from './shared-parts.js';

/** A signal that never aborts. Reads, history set-up and the start-up apply run under it. */
export const UNCANCELLED: AbortSignal = new AbortController().signal;

/**
 * What Authoring's helpers are built from: the open stores, the built-in presets and the shared
 * parts (compose/shared-parts.ts).
 */
export interface AuthoringInputs {
  readonly stores: {
    readonly storage: ConditionalStorage;
    readonly assets: Pick<Assets, 'resolve' | 'acquire'>;
  };
  readonly builtins: Pick<PreparedBuiltins, 'presets'>;
  readonly options: Pick<WorkspaceOptions, 'workspace' | 'title' | 'createdAt'>;
  readonly capabilities: Pick<ServiceCapabilities, 'model' | 'library' | 'language'>;
  readonly shared: Pick<SharedParts, 'reader' | 'resources' | 'commands' | 'jobs' | 'producer'>;
  /** Where Authoring publishes committed changes. */
  readonly changes: Notifications;
}

/** One workspace's Authoring, and what start-up needs from it. */
export interface BuiltAuthoring {
  /** Makes Authoring for one request; its renders stop when `signal` aborts. */
  readonly authoring: (signal: AbortSignal) => Authoring;
  /**
   * Checks the workspace as a change would leave it (the "candidate"). Start-up also runs it on the
   * stored workspace.
   */
  readonly candidateCheck: CandidateValidator;
  /**
   * The request that fills a brand-new workspace with its seed (`NewWorkspaceSeed`). If the
   * built-in presets are too big for Authoring, this holds that failure; only a new workspace uses
   * it.
   */
  readonly seedRequest: AuthoringResult<Request>;
  /** Starts undo history for a workspace that has none, or checks the history it has. */
  readonly startHistory: () => Promise<AuthoringResult<HistoryStatus>>;
}

/**
 * Builds Authoring's helpers for one workspace. Never fails; throws only if the storage code can't
 * load.
 */
export async function buildAuthoring(inputs: AuthoringInputs): Promise<BuiltAuthoring> {
  const storeModule = await import('../../adapters/storage/authoring-store.js');
  const seed = newWorkspaceSeed(inputs);
  const store = storeModule.createAuthoringStore(inputs.stores.storage);
  const runtime = admissionRuntime(inputs, seed, store);
  const startup = requestAuthoring(runtime, UNCANCELLED);
  return {
    authoring: (signal) => requestAuthoring(runtime, signal),
    candidateCheck: runtime.validation,
    seedRequest: buildSeedRequest(seed),
    startHistory: () => startup.initializeHistory(inputs.options.workspace),
  };
}

/** What a brand-new workspace starts with: its ID, title, creation time and built-in presets. */
function newWorkspaceSeed(inputs: AuthoringInputs): NewWorkspaceSeed {
  return {
    workspace: inputs.options.workspace,
    title: inputs.options.title,
    createdAt: inputs.options.createdAt,
    presets: inputs.builtins.presets,
  };
}

/** The Authoring roles bound once per workspace; each request composes Authoring over them. */
interface AdmissionRuntime {
  readonly store: AuthoringStore;
  readonly planners: readonly IntentPlanner[];
  readonly validation: CandidateValidator;
  readonly resources: ResourceAdmission;
  readonly changes: Notifications;
  /** What the layout check needs; each request adds its own signal. */
  readonly feasibility: Omit<FeasibilityDependencies, 'signal'>;
}

/** Binds the store, planners, validator, leases, notifications and feasibility. Never fails. */
function admissionRuntime(
  inputs: AuthoringInputs,
  seed: NewWorkspaceSeed,
  store: AuthoringStore,
): AdmissionRuntime {
  const { reader, resources, jobs, producer } = inputs.shared;
  const assets = inputs.stores.assets;
  return {
    store,
    planners: planners(inputs, seed),
    validation: createCandidateValidator({ workspace: reader, resources, assets }),
    resources: createResourceAdmission(resources, assets),
    changes: inputs.changes,
    feasibility: { workspace: reader, jobs, producer },
  };
}

/** The service planners, bootstrap first. Never fails. */
function planners(
  inputs: AuthoringInputs,
  seed: NewWorkspaceSeed,
): readonly IntentPlanner[] {
  const { model, library, language } = inputs.capabilities;
  const { reader, resources, commands } = inputs.shared;
  const collections = createCollectionPlanner({ library, workspace: reader, resources });
  return [
    createBootstrapPlanner(seed),
    createPresetPlanner(commands),
    createLibraryPlanner({ library, workspace: reader }),
    createDslPlanner({ language, workspace: reader, resources, collections }),
    createModelPlanner({ model, workspace: reader, collections }),
  ];
}

/**
 * Composes Authoring for one request; its feasibility renders run under that request's signal.
 * Throws only when a planner's `id` getter throws (see `composeAuthoring`).
 */
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
    feasibility: createFeasibility({ ...runtime.feasibility, signal }),
  });
}
