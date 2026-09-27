/*
 * Authoring for one workspace. The roles the service plugs into Authoring (store, planners,
 * candidate validation, resource leases, change notifications, feasibility) are bound once; one
 * Authoring is composed per request, so a request's cancellation reaches its own feasibility
 * renders without a global current-request variable. The store adapter loads lazily. Authoring
 * owns commit, receipts and recovery.
 */
import { composeAuthoring } from '@novakai/canvas-authoring';
import type {
  Authoring,
  CandidateValidator,
  HistoryStatus,
  IntentPlanner,
  Request,
  ResourceAdmission,
  Result as AuthoringResult,
} from '@novakai/canvas-authoring';
import type { NativeWorkspace, WorkspaceOptions } from '../records/workspace/startup.js';
import type { Installation } from '../records/workspace/installation.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
import type { ChangeChannel } from '../ports/notifications.js';
import type { FeasibilityOwners } from '../ports/render-jobs.js';
import type { AuthoringStore } from '../ports/storage.js';
import { createResourceAdmission } from '../../core/authoring-roles/resource-leases.js';
import { createFeasibility } from '../../core/authoring-roles/feasibility.js';
import { createCandidateValidator } from '../../core/authoring-roles/validation/candidate.js';
import {
  createInstallationPlanner,
  installationRequest,
} from '../../core/authoring-roles/planners/bootstrap.js';
import { createCollectionPlanner } from '../../core/authoring-roles/planners/collection-proposal.js';
import { createDslPlanner } from '../../core/authoring-roles/planners/dsl.js';
import { createModelPlanner } from '../../core/authoring-roles/planners/model.js';
import { createLibraryPlanner } from '../../core/authoring-roles/planners/library.js';
import { createPresetPlanner } from '../../core/authoring-roles/planners/preset.js';
import type { WorkspaceRoles } from './workspace.js';

/** A signal that never aborts. Reads, history adoption and the startup apply run under it. */
export const UNCANCELLED: AbortSignal = new AbortController().signal;

/** What Authoring is bound over: the open workspace, its installation and the shared roles. */
export interface AuthoringInputs {
  readonly native: NativeWorkspace;
  readonly installation: BuiltinResources;
  readonly options: WorkspaceOptions;
  readonly capabilities: ServiceCapabilities;
  readonly roles: WorkspaceRoles;
  readonly changes: ChangeChannel;
}

/** One workspace's Authoring, plus what startup validates, applies and adopts. */
export interface WiredAuthoring {
  /** Authoring bound to one request's cancellation. */
  readonly authoring: (signal: AbortSignal) => Authoring;
  readonly validation: CandidateValidator;
  /** The installation request a new workspace applies once. */
  readonly initialize: AuthoringResult<Request>;
  /** Adopts the stored history, under `UNCANCELLED`. */
  readonly adopt: () => Promise<AuthoringResult<HistoryStatus>>;
}

/** The Authoring roles bound once per workspace; each request composes Authoring over them. */
interface AdmissionRuntime {
  readonly store: AuthoringStore;
  readonly planners: readonly IntentPlanner[];
  readonly validation: CandidateValidator;
  readonly resources: ResourceAdmission;
  readonly changes: ChangeChannel;
  readonly feasibility: FeasibilityOwners;
}

/**
 * Loads the store adapter and binds the workspace's Authoring roles. Rejects when the adapter
 * cannot load, or when the trusted installation breaks Authoring's proposal limits (see
 * `installationRequest`); compose startup answers both `unavailable` and closes the native
 * handles.
 */
export async function wireAuthoring(inputs: AuthoringInputs): Promise<WiredAuthoring> {
  const storeModule = await import('../../adapters/storage/authoring-store.js');
  const installation = installationRecords(inputs);
  const store = storeModule.createAuthoringStore(inputs.native.storage);
  const runtime = admissionRuntime(inputs, installation, store);
  const workspace = inputs.options.workspace;
  return {
    authoring: (signal) => requestAuthoring(runtime, signal),
    validation: runtime.validation,
    initialize: installationRequest(installation),
    adopt: () => requestAuthoring(runtime, UNCANCELLED).initializeHistory(workspace),
  };
}

/** The trusted installation records a new workspace starts with. Never fails. */
function installationRecords(inputs: AuthoringInputs): Installation {
  return {
    workspace: inputs.options.workspace,
    title: inputs.options.title,
    createdAt: inputs.options.createdAt,
    presets: inputs.installation.presets,
  };
}

/** Binds the store, planners, validator, leases, notifications and feasibility. Never fails. */
function admissionRuntime(
  inputs: AuthoringInputs,
  installation: Installation,
  store: AuthoringStore,
): AdmissionRuntime {
  const { views, resources, jobs, producer } = inputs.roles;
  const assets = inputs.native.assets;
  return {
    store,
    planners: planners(inputs, installation),
    validation: createCandidateValidator({ workspace: views, resources, assets }),
    resources: createResourceAdmission(resources, assets),
    changes: inputs.changes,
    feasibility: { workspace: views, jobs, producer },
  };
}

/** The service planners, bootstrap first. Never fails. */
function planners(
  inputs: AuthoringInputs,
  installation: Installation,
): readonly IntentPlanner[] {
  const { model, library, language } = inputs.capabilities;
  const { views, resources, commands } = inputs.roles;
  const collections = createCollectionPlanner({ library, workspace: views, resources });
  return [
    createInstallationPlanner(installation),
    createPresetPlanner(commands),
    createLibraryPlanner({ library, workspace: views }),
    createDslPlanner({ language, workspace: views, resources, collections }),
    createModelPlanner({ model, workspace: views, collections }),
  ];
}

/** Composes Authoring for one request; its feasibility renders run under that request's signal. */
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
