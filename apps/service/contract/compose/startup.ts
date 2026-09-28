/*
 * Why this file exists
 *
 * `pnpm dev` must turn a workspace folder into a running session. For example, an empty folder
 * becomes a new workspace called `local` with the shipped themes, while an existing one is checked
 * as it is. Several things must happen in order, and a failure part-way must not leave files open.
 *
 * This file runs that order: open the files, prepare the shipped resources, start the render
 * worker, build the session, then start it (core/session/startup.ts). If a step fails, it closes
 * the files and returns the mistake. It never deletes or rewrites what is already stored.
 */
import { openAssets } from '@novakai/canvas-assets';
import { openSqlite } from '@novakai/canvas-persistence';
import type { WorkspaceOptions, OpenStores } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { DiagramProducer } from '../ports/rendering.js';
import type { WorkspaceSession } from '../types.js';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import { startWorkspace } from '../../core/session/startup.js';
import { prepareBuiltins } from './builtins.js';
import { startRenderWorkers } from './producer.js';
import { wireWorkspace } from './wiring.js';

/**
 * Opens the workspace folder and starts its session. Fails with the first step's mistake:
 * `unavailable` when the files, the render worker or a later step can't start, or the mistake
 * `prepareBuiltins` or core start-up found. The files are closed on any failure.
 */
export async function openWorkspace(options: WorkspaceOptions): Promise<Result<WorkspaceSession>> {
  try {
    const files = await import('../../adapters/files/workspace-files.js');
    const stores = await files.openWorkspaceFiles(options, {
      assets: openAssets,
      storage: openSqlite,
    });
    if (!stores.ok) return stores;
    return await startOpened(stores.value, options);
  } catch {
    return failure('unavailable', 'startup', 'Workspace could not open; retain its existing files');
  }
}

/**
 * Starts an opened workspace; any failure or throw closes the stores. A throw is
 * `unavailable` at `startup` ("Workspace composition failed").
 */
async function startOpened(
  stores: OpenStores,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const result = await configureWorkspace(stores, options).catch(() =>
    failure<WorkspaceSession>('unavailable', 'startup', 'Workspace composition failed'),
  );
  if (!result.ok) await stores.close();
  return result;
}

/** Prepares the built-in resources and starts the render workers, then wires the workspace. */
async function configureWorkspace(
  stores: OpenStores,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const builtins = await prepareBuiltins(options.resourceRoot, options.tokenRoot, stores.assets);
  if (!builtins.ok) return builtins;
  const renderWorkers = await startRenderWorkers();
  if (!renderWorkers.ok) return renderWorkers;
  return wireAndStart(stores, builtins.value, options, renderWorkers.value);
}

/** Wires the workspace, then runs core startup; the session is answered only once it started. */
async function wireAndStart(
  stores: OpenStores,
  builtins: BuiltinResources,
  options: WorkspaceOptions,
  renderWorkers: DiagramProducer,
): Promise<Result<WorkspaceSession>> {
  const wired = await wireWorkspace(stores, builtins, options, renderWorkers);
  if (!wired.ok) return wired;
  const started = await startWorkspace(wired.value);
  if (!started.ok) return started;
  return success(wired.value.session);
}
