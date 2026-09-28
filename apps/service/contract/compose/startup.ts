/*
 * Workspace startup, in order: open the workspace files → prepare the installation → start the
 * render worker → wire the workspace → run core startup (core/session/startup.ts decides between
 * validating an existing workspace and initializing a new one). Every canonical write passes
 * through Authoring. A failed startup releases only the native handles; committed records and
 * staged bytes stay where they are, and the caller retries.
 */
import { openAssets } from '@novakai/canvas-assets';
import { openSqlite } from '@novakai/canvas-persistence';
import type { WorkspaceOptions, NativeWorkspace } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { DiagramProducer } from '../ports/rendering.js';
import type { WorkspaceSession } from '../types.js';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import { startWorkspace } from '../../core/session/startup.js';
import { prepareInstallation } from './installation.js';
import { createDiagramProducer } from './producer.js';
import { wireWorkspace } from './wiring.js';

/**
 * Opens a persistent workspace and starts its session. Fails with `unavailable` at `startup`
 * ("Workspace could not open; retain its existing files") when the files adapter cannot load or
 * throws; otherwise as the files adapter, `prepareInstallation`, `createDiagramProducer`,
 * `wireWorkspace` and `startWorkspace` answer, or `unavailable` at `startup` ("Workspace
 * composition failed") when a later step throws. The caller owns startup recovery.
 */
export async function openWorkspace(options: WorkspaceOptions): Promise<Result<WorkspaceSession>> {
  try {
    const files = await import('../../adapters/files/workspace-files.js');
    const native = await files.openWorkspaceFiles(options, {
      assets: openAssets,
      storage: openSqlite,
    });
    if (!native.ok) return native;
    return await startOpened(native.value, options);
  } catch {
    return failure('unavailable', 'startup', 'Workspace could not open; retain its existing files');
  }
}

/**
 * Starts an opened workspace; any failure or throw closes the native handles. A throw is
 * `unavailable` at `startup` ("Workspace composition failed").
 */
async function startOpened(
  native: NativeWorkspace,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const result = await configureWorkspace(native, options).catch(() =>
    failure<WorkspaceSession>('unavailable', 'startup', 'Workspace composition failed'),
  );
  if (!result.ok) await native.close();
  return result;
}

/** Installation and the render worker are ready before the workspace is wired. */
async function configureWorkspace(
  native: NativeWorkspace,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const installation = await prepareInstallation(
    options.resourceRoot,
    options.tokenRoot,
    native.assets,
  );
  if (!installation.ok) return installation;
  const producer = await createDiagramProducer();
  if (!producer.ok) return producer;
  return wireAndStart(native, installation.value, options, producer.value);
}

/** Wires the workspace, then runs core startup; the session is answered only once it started. */
async function wireAndStart(
  native: NativeWorkspace,
  installation: BuiltinResources,
  options: WorkspaceOptions,
  producer: DiagramProducer,
): Promise<Result<WorkspaceSession>> {
  const wired = await wireWorkspace(native, installation, options, producer);
  if (!wired.ok) return wired;
  const started = await startWorkspace(wired.value);
  if (!started.ok) return started;
  return success(wired.value.session);
}
