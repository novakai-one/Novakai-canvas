/*
 * Wiring one workspace, in order: capabilities → shared workspace roles → Authoring → export →
 * session. Each step is its own compose module; this file only sequences them. The change channel
 * adapter loads lazily. Adapters never import siblings or reach another capability's private
 * implementation.
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

/** The wired workspace: its session, plus what core startup validates, applies and adopts. */
export interface WiredWorkspace extends StartupOwners {
  readonly session: WorkspaceSession;
}

/**
 * Wires one workspace's adapters, core and capabilities into its session. Fails as `wireExport`
 * (`unavailable` at `startup`, "Workspace composition failed") when Presentation cannot bind the
 * installation fonts. Rejects when an adapter cannot load or `wireAuthoring` throws; compose
 * startup answers that with the same failure and closes the native handles.
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
    initialize: authoring.initialize,
    signal: UNCANCELLED,
    adopt: authoring.adopt,
  });
}
