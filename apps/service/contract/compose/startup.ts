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
    return await openStoresThenStart(options);
  } catch {
    return workspaceOpenFailure();
  }
}

/** How the workspace folder's two stores are opened: Assets for files, SQLite for records. */
const STORE_OPENERS: StoreOpeners = Object.freeze({ assets: openAssets, storage: openSqlite });

/** Opens the workspace folder's stores, then starts the workspace on them. */
async function openStoresThenStart(options: WorkspaceOptions): Promise<Result<WorkspaceSession>> {
  const workspaceFiles = await import('../../adapters/files/workspace-files.js');
  const stores = await workspaceFiles.openWorkspaceFiles(options, STORE_OPENERS);
  if (!stores.ok) {
    return stores;
  }
  return startOrCloseStores(stores.value, options);
}

/** Starts the workspace on its open stores, and closes the stores if that fails or throws. */
async function startOrCloseStores(
  stores: OpenStores,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const started = await prepareAndStart(stores, options).catch(workspaceBuildFailure);
  if (!started.ok) {
    await stores.close();
  }
  return started;
}

/** Prepares the shipped resources and the render workers, then builds and starts the workspace. */
async function prepareAndStart(
  stores: OpenStores,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const prepared = await prepareParts(stores, options);
  if (!prepared.ok) {
    return prepared;
  }
  return buildAndStart(stores, prepared.value, options);
}

/** The shipped resources and the running render workers that the workspace is built with. */
interface PreparedParts {
  readonly builtins: PreparedBuiltins;
  readonly renderWorkers: DiagramProducer;
}

/** Prepares the shipped resources, then starts the render workers. */
async function prepareParts(
  stores: OpenStores,
  options: WorkspaceOptions,
): Promise<Result<PreparedParts>> {
  const builtins = await prepareBuiltins(options.resourceRoot, options.tokenRoot, stores.assets);
  if (!builtins.ok) {
    return builtins;
  }
  const renderWorkers = await startRenderWorkers();
  if (!renderWorkers.ok) {
    return renderWorkers;
  }
  return success({ builtins: builtins.value, renderWorkers: renderWorkers.value });
}

/** Builds the workspace, runs core start-up on it, and answers its session once it started. */
async function buildAndStart(
  stores: OpenStores,
  prepared: PreparedParts,
  options: WorkspaceOptions,
): Promise<Result<WorkspaceSession>> {
  const built = await buildWorkspace(stores, prepared.builtins, options, prepared.renderWorkers);
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
function workspaceOpenFailure(): Result<never> {
  return failure('unavailable', 'startup', 'Workspace could not open; retain its existing files');
}

/** The `unavailable` failure at `startup` for a workspace that threw while it was built. */
function workspaceBuildFailure(): Result<never> {
  return failure('unavailable', 'startup', 'Workspace composition failed');
}
