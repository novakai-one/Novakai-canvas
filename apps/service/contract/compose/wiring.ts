/*
 * Why this file exists
 *
 * One open workspace needs many parts built in the right order, because each uses the ones before
 * it: the capabilities, then the shared helpers ("roles", compose/workspace.ts), then Authoring,
 * then the exporter, then the session.
 *
 * This file builds them in that order. Each part is built by its own compose file; this file only
 * runs them in sequence and hands start-up what it needs.
 */
import type { WorkspaceOptions, OpenStores } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { DiagramProducer } from '../ports/rendering.js';
import type { WorkspaceSession } from '../types.js';
import type {
  AuthoringResult,
  CandidateValidator,
  HistoryStatus,
  Request,
} from '../records/capability-types.js';
import type { Result } from '../errors.js';
import { success } from '../errors.js';
import { createServiceCapabilities } from './capabilities.js';
import { wireWorkspaceRoles } from './workspace.js';
import { UNCANCELLED, wireAuthoring } from './authoring.js';
import { wireExport } from './export.js';
import { wireSession } from './session.js';

/**
 * The built workspace: its session, and what start-up (core/session/startup.ts) needs to check an
 * existing workspace or fill a new one.
 */
export interface WiredWorkspace {
  readonly session: WorkspaceSession;
  /** Checks an existing workspace as stored (see `WiredAuthoring.existingWorkspaceCheck`). */
  readonly existingWorkspaceCheck: CandidateValidator;
  /** The request that fills a brand-new workspace with its seed, or why it can't be made. */
  readonly seedRequest: AuthoringResult<Request>;
  /** The signal the seed request is applied under. It never aborts. */
  readonly signal: AbortSignal;
  /** Starts undo history for a workspace that has none, or checks the history it has. */
  readonly startHistory: () => Promise<AuthoringResult<HistoryStatus>>;
}

/**
 * Builds one workspace's parts into its session. Fails with `unavailable` at `startup` when
 * Presentation can't load the shipped fonts. Rejects if a part's code can't load; start-up turns
 * that into the same failure.
 */
export async function wireWorkspace(
  stores: OpenStores,
  builtins: BuiltinResources,
  options: WorkspaceOptions,
  renderWorkers: DiagramProducer,
): Promise<Result<WiredWorkspace>> {
  const channel = await import('../../adapters/notifications/change-channel.js');
  const capabilities = createServiceCapabilities(builtins.tokens);
  const roles = wireWorkspaceRoles({
    assets: stores.assets,
    builtins,
    resourceRoot: options.resourceRoot,
    capabilities,
    renderWorkers,
  });
  const changes = channel.createChangeChannel();
  const parts = { stores, builtins, options, capabilities, roles, changes };
  const authoring = await wireAuthoring(parts);
  const exporter = await wireExport(parts, authoring.authoring);
  if (!exporter.ok) return exporter;
  return success({
    session: wireSession(parts, authoring.authoring, exporter.value),
    existingWorkspaceCheck: authoring.existingWorkspaceCheck,
    seedRequest: authoring.seedRequest,
    signal: UNCANCELLED,
    startHistory: authoring.startHistory,
  });
}
