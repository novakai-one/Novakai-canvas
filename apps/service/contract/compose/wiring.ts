/*
 * Why this file exists
 *
 * One open workspace needs many parts built in the right order, because each uses the ones before
 * it: the capabilities, then the shared roles, then Authoring, then the export route, then the
 * session.
 *
 * This file builds them in that order. Each part is built by its own compose file; this file only
 * runs them in sequence and hands start-up what it needs.
 */
import type { WorkspaceOptions, NativeWorkspace } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { DiagramProducer } from '../ports/rendering.js';
import type { WorkspaceSession } from '../types.js';
import type { Result } from '../errors.js';
import { success } from '../errors.js';
import type { StartupOwners } from '../../core/session/startup.js';
import { createServiceCapabilities } from './capabilities.js';
import { wireWorkspaceRoles } from './workspace.js';
import { UNCANCELLED, wireAuthoring } from './authoring.js';
import { wireExport } from './export.js';
import { wireSession } from './session.js';

/** The built workspace: its session, and what core start-up needs to check or fill it. */
export interface WiredWorkspace extends StartupOwners {
  readonly session: WorkspaceSession;
}

/**
 * Builds one workspace's parts into its session. `worker` is the render worker pool. Fails with
 * `unavailable` at `startup` when Presentation can't load the shipped fonts. Rejects if a part's
 * code can't load; start-up turns that into the same failure.
 */
export async function wireWorkspace(
  native: NativeWorkspace,
  installation: BuiltinResources,
  options: WorkspaceOptions,
  worker: DiagramProducer,
): Promise<Result<WiredWorkspace>> {
  const channel = await import('../../adapters/notifications/change-channel.js');
  const capabilities = createServiceCapabilities(installation.tokens);
  const roles = wireWorkspaceRoles({
    assets: native.assets,
    installation,
    resourceRoot: options.resourceRoot,
    capabilities,
    worker,
  });
  const changes = channel.createChangeChannel();
  const parts = { native, installation, options, capabilities, roles, changes };
  const authoring = await wireAuthoring(parts);
  const exporter = await wireExport(parts, authoring.authoring);
  if (!exporter.ok) return exporter;
  return success({
    session: wireSession(parts, authoring.authoring, exporter.value),
    validation: authoring.validation,
    initialize: authoring.installationRequest,
    signal: UNCANCELLED,
    adopt: authoring.adopt,
  });
}
