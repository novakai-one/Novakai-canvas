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
import type { Installation, WorkspaceOptions } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
import type { AuthoringStore, ConditionalStorage } from '../ports/storage.js';
import { createResourceAdmission } from '../../core/authoring-roles/resource-leases.js';
import {
  createFeasibility,
  type FeasibilityOwners,
} from '../../core/authoring-roles/feasibility.js';
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

/** A signal that never aborts. Reads, history set-up and the start-up apply run under it. */
export const UNCANCELLED: AbortSignal = new AbortController().signal;

/**
 * What Authoring's helpers are built from: the open stores, the installation and the shared roles.
 */
export interface AuthoringInputs {
  readonly native: {
    readonly storage: ConditionalStorage;
    readonly assets: Pick<Assets, 'resolve' | 'acquire'>;
  };
  readonly installation: Pick<BuiltinResources, 'presets'>;
  readonly options: Pick<WorkspaceOptions, 'workspace' | 'title' | 'createdAt'>;
  readonly capabilities: Pick<ServiceCapabilities, 'model' | 'library' | 'language'>;
  readonly roles: Pick<WorkspaceRoles, 'views' | 'resources' | 'commands' | 'jobs' | 'producer'>;
  /** Where Authoring publishes committed changes. */
  readonly changes: Notifications;
}

/** One workspace's Authoring, and what start-up needs from it. */
export interface WiredAuthoring {
  /** Makes Authoring for one request; its renders stop when `signal` aborts. */
  readonly authoring: (signal: AbortSignal) => Authoring;
  /** The check start-up runs on an existing workspace. */
  readonly validation: CandidateValidator;
  /** The request that fills a new workspace with its installation, applied once. */
  readonly installationRequest: AuthoringResult<Request>;
  /** Adds undo history to a workspace that has none, or checks the history it has. */
  readonly adopt: () => Promise<AuthoringResult<HistoryStatus>>;
}

/**
 * Builds Authoring's helpers for one workspace. Never fails: an installation too big for Authoring
 * becomes `installationRequest`'s failure, which only a new workspace sees. Rejects only if the
 * storage code can't load.
 */
export async function wireAuthoring(inputs: AuthoringInputs): Promise<WiredAuthoring> {
  const storeModule = await import('../../adapters/storage/authoring-store.js');
  const installation = installationRecords(inputs);
  const store = storeModule.createAuthoringStore(inputs.native.storage);
  const runtime = admissionRuntime(inputs, installation, store);
  const startup = requestAuthoring(runtime, UNCANCELLED);
  return {
    authoring: (signal) => requestAuthoring(runtime, signal),
    validation: runtime.validation,
    installationRequest: installationRequest(installation),
    adopt: () => startup.initializeHistory(inputs.options.workspace),
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

/** The Authoring roles bound once per workspace; each request composes Authoring over them. */
interface AdmissionRuntime {
  readonly store: AuthoringStore;
  readonly planners: readonly IntentPlanner[];
  readonly validation: CandidateValidator;
  readonly resources: ResourceAdmission;
  readonly changes: Notifications;
  /** Feasibility's owners; each request adds its own signal. */
  readonly feasibility: Omit<FeasibilityOwners, 'signal'>;
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
