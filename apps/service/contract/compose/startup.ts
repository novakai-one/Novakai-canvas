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
import type { OpenStores, StoreOpeners, WorkspaceOptions } from '../records/workspace/startup.js';
import type { PreparedBuiltins } from '../records/presets/builtins.js';
import type { DiagramProducer } from '../ports/rendering.js';
import type { WorkspaceSession } from '../types.js';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import { startWorkspace } from '../../core/session/startup.js';
import { prepareBuiltins } from './builtins.js';
import { startRenderWorkers } from './producer.js';
import { buildWorkspace } from './workspace.js';

/**
 * Opens the workspace folder and starts its session. Fails with the first step's mistake:
 * `unavailable` when the files, the render worker or a later step can't start, or the mistake
 * `prepareBuiltins` or core start-up found. The files are closed on any failure.
 */
export async function openWorkspace(options: WorkspaceOptions): Promise<Result<WorkspaceSession>> {
  try {
    return await openAndStart(options);
  } catch {
    return workspaceUnopenedFailure();
  }
}

/** How the workspace folder's two stores are opened: Assets for files, SQLite for records. */
const STORE_OPENERS: StoreOpeners = Object.freeze({ assets: openAssets, storage: openSqlite });

/** Opens the workspace folder's stores, then starts the workspace on them. */
async function openAndStart(options: WorkspaceOptions): Promise<Result<WorkspaceSession>> {
  const workspaceFiles = await import('../../adapters/files/workspace-files.js');
  const stores = await workspaceFiles.openWorkspaceFiles(options, STORE_OPENERS);
  if (!stores.ok) {
    return stores;
  }
  return startOpened(stores.value, options);
}

/** Starts the opened workspace, and closes its stores if that fails or throws. */
async function startOpened(
  stores: OpenStores,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const started = await configureWorkspace(stores, options).catch(compositionFailure);
  if (!started.ok) {
    await stores.close();
  }
  return started;
}

/** Prepares the built-in resources and starts the render workers, then builds the workspace. */
async function configureWorkspace(
  stores: OpenStores,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const builtins = await prepareBuiltins(options.resourceRoot, options.tokenRoot, stores.assets);
  if (!builtins.ok) {
    return builtins;
  }
  const renderWorkers = await startRenderWorkers();
  if (!renderWorkers.ok) {
    return renderWorkers;
  }
  return buildAndStart(stores, builtins.value, options, renderWorkers.value);
}

/** Builds the workspace, runs core start-up on it, and answers its session once it started. */
async function buildAndStart(
  stores: OpenStores,
  builtins: PreparedBuiltins,
  options: WorkspaceOptions,
  renderWorkers: DiagramProducer,
): Promise<Result<WorkspaceSession>> {
  const built = await buildWorkspace(stores, builtins, options, renderWorkers);
  if (!built.ok) {
    return built;
  }
  const started = await startWorkspace(built.value);
  if (!started.ok) {
    return started;
  }
  return success(built.value.session);
}

/** The `unavailable` failure at `startup` for a workspace that threw while it was opened. */
function workspaceUnopenedFailure(): Result<never> {
  return failure('unavailable', 'startup', 'Workspace could not open; retain its existing files');
}

/** The `unavailable` failure at `startup` for a workspace that threw while it was built. */
function compositionFailure(): Result<never> {
  return failure('unavailable', 'startup', 'Workspace composition failed');
}
