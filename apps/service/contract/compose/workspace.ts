/*
 * Why this file exists
 *
 * One open workspace needs many parts built in the right order, because each uses the ones before
 * it: the capabilities, then the shared parts (compose/shared-parts.ts), then Authoring, then the
 * exporter, then the session.
 *
 * This file builds them in that order. Each part is built by its own compose file; this file only
 * runs them in sequence and hands start-up what it needs.
 */
import type { WorkspaceOptions, OpenStores } from '../records/workspace/startup.js';
import type { PreparedBuiltins } from '../records/presets/builtins.js';
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
import { buildSharedParts } from './shared-parts.js';
import { UNCANCELLED, buildAuthoring, type BuiltAuthoring } from './authoring.js';
import { buildExporter } from './export.js';
import { buildSession } from './session.js';

/**
 * The built workspace: its session, and what start-up (core/session/startup.ts) needs to check an
 * existing workspace or fill a new one.
 */
export interface BuiltWorkspace {
  readonly session: WorkspaceSession;
  /** Authoring's candidate check; start-up runs it on the stored workspace. */
  readonly candidateCheck: CandidateValidator;
  /** The request that fills a brand-new workspace with its seed, or why it can't be made. */
  readonly seedRequest: AuthoringResult<Request>;
  /**
   * The signal the seed request is applied under: always `UNCANCELLED`. It is passed in so core
   * start-up need not import compose.
   */
  readonly signal: AbortSignal;
  /** Starts undo history for a workspace that has none, or checks the history it has. */
  readonly startHistory: () => Promise<AuthoringResult<HistoryStatus>>;
}

/**
 * Builds one workspace's parts into its session. Fails with `unavailable` at `startup` when
 * Presentation can't load the shipped fonts. Throws if a part's code can't load; start-up turns
 * that into the same failure.
 */
export async function buildWorkspace(
  stores: OpenStores,
  builtins: PreparedBuiltins,
  options: WorkspaceOptions,
  renderWorkers: DiagramProducer,
): Promise<Result<BuiltWorkspace>> {
  const changeChannel = await import('../../adapters/notifications/change-channel.js');
  const capabilities = createServiceCapabilities(builtins.tokens);
  const shared = buildSharedParts({
    assets: stores.assets,
    builtins,
    resourceRoot: options.resourceRoot,
    capabilities,
    renderWorkers,
  });
  const changes = changeChannel.createChangeChannel();
  const parts = { stores, builtins, options, capabilities, shared, changes };
  const builtAuthoring = await buildAuthoring(parts);
  const exporter = await buildExporter(parts, builtAuthoring.authoring);
  if (!exporter.ok) {
    return exporter;
  }
  const session = buildSession(parts, builtAuthoring.authoring, exporter.value);
  return success(builtWorkspace(session, builtAuthoring));
}

/** Joins the session with what start-up needs from Authoring. */
function builtWorkspace(
  session: WorkspaceSession,
  builtAuthoring: BuiltAuthoring,
): BuiltWorkspace {
  return {
    session,
    candidateCheck: builtAuthoring.candidateCheck,
    seedRequest: builtAuthoring.seedRequest,
    signal: UNCANCELLED,
    startHistory: builtAuthoring.startHistory,
  };
}
