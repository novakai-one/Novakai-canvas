/*
 * Workspace startup: resource preparation and worker construction precede registration of the
 * authoritative workspace facade. Existing workspaces are validated without rewriting them; new
 * workspaces receive one ordinary atomic initialization request. Failed startup releases only
 * native handles; committed records and staged bytes remain at their original location.
 */
import { openAssets } from '@novakai/canvas-assets';
import { openSqlite } from '@novakai/canvas-persistence';
import type { Result as AuthoringResult } from '@novakai/canvas-authoring';
import type { WorkspaceOptions, NativeWorkspace } from '../records/startup.js';
import type { BuiltinResources } from '../records/builtins.js';
import type { DiagramProducer } from '../ports/rendering.js';
import type { Snapshot } from '../records/owners.js';
import type { WorkspaceSession } from '../types.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import { prepareInstallation } from './installation.js';
import { createDiagramProducer } from './rendering.js';
import { wireWorkspace } from './wiring.js';
import type { WiredWorkspace } from './wiring.js';

/** Open a real persistent workspace explicitly. Every canonical initial/edit write passes through Authoring; caller owns startup recovery. */
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

/** Resource preparation and worker construction precede registration of the authoritative workspace facade. */
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
  const producer = await createDiagramProducer(30000);
  if (!producer.ok) return producer;
  return wireAndInitialize(native, installation.value, options, producer.value);
}

/** Wiring failure loses no workspace state; initialization starts from the wired owners. */
async function wireAndInitialize(
  native: NativeWorkspace,
  installation: BuiltinResources,
  options: WorkspaceOptions,
  producer: DiagramProducer,
): Promise<Result<WorkspaceSession>> {
  const wired = await wireWorkspace(native, installation, options, producer);
  if (!wired.ok) return wired;
  return initialize(wired.value);
}

/** Failed startup releases only native handles; committed records and staged bytes remain at their original location. */
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

/** Existing workspaces are validated without rewriting them; new workspaces receive one ordinary atomic initialization request. */
async function initialize(wired: WiredWorkspace): Promise<Result<WorkspaceSession>> {
  const snapshot = await wired.session.read();
  if (!snapshot.ok)
    return failure('unavailable', snapshot.error.path, snapshot.error.message, snapshot.error);
  const existing = snapshot.value.records.some(
    (item) => item.key.kind === 'workspace' && !item.deleted,
  );
  const ready = await initialized(existing, snapshot.value, wired);
  if (!ready.ok) return ready;
  return started(await wired.adopt(), wired.session);
}

/** Startup never replaces an existing catalog after a failed read or failed owner validation. */
async function initialized(
  existing: boolean,
  snapshot: Snapshot,
  wired: WiredWorkspace,
): Promise<Result<WorkspaceSession>> {
  if (existing) {
    const checked = await wired.validation.validate(snapshot, snapshot, []);
    return started(checked, wired.session);
  }
  if (!wired.initialize.ok)
    return failure(
      'invalid-input',
      wired.initialize.error.path,
      wired.initialize.error.message,
      wired.initialize.error,
    );
  return started(
    await wired.session.apply(wired.initialize.value, new AbortController().signal),
    wired.session,
  );
}

/** A startup receipt proves initialization was admitted; an existing-state result proves its current owner contracts. */
function started(
  result: AuthoringResult<unknown>,
  session: WorkspaceSession,
): Result<WorkspaceSession> {
  if (!result.ok)
    return failure('unavailable', result.error.path, result.error.message, result.error);
  return { ok: true, value: session };
}
