/*
 * The session of one workspace: the core facade over the shared roles, per-request Authoring and
 * the export route, with a lifetime that drains admitted work, then closes the change channel and
 * the native handles. Construction starts no I/O; the caller keeps the workspace when close fails.
 */
import type { Authoring } from '@novakai/canvas-authoring';
import type { NativeWorkspace, WorkspaceOptions } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { ExportHandler } from '../ports/export.js';
import type { ChangeChannel } from '../ports/notifications.js';
import type { WorkspaceSession } from '../types.js';
import { authoringFailure } from '../errors.js';
import { createWorkspaceSession } from '../../core/session/facade.js';
import { createSessionLifetime } from '../../core/session/lifetime.js';
import type { WorkspaceRoles } from './workspace.js';
import { UNCANCELLED } from './authoring.js';

/** What the session binds, besides Authoring and the export route. */
export interface SessionInputs {
  readonly native: Pick<NativeWorkspace, 'close'>;
  readonly installation: BuiltinResources;
  readonly options: Pick<WorkspaceOptions, 'workspace'>;
  readonly roles: Pick<WorkspaceRoles, 'commands' | 'views' | 'renderer'>;
  readonly changes: Pick<ChangeChannel, 'subscribe' | 'close'>;
}

/**
 * Binds the session facade; `authoring` is bound to one request's cancellation. Once the session
 * is closing, Authoring calls answer `storage-unavailable` at `session`; see
 * `createWorkspaceSession` for the other answers. Never fails.
 */
export function wireSession(
  inputs: SessionInputs,
  authoring: (signal: AbortSignal) => Authoring,
  exporter: ExportHandler,
): WorkspaceSession {
  const { native, changes, roles } = inputs;
  const lifetime = createSessionLifetime(async () => {
    changes.close();
    return native.close();
  });
  return createWorkspaceSession({
    workspace: inputs.options.workspace,
    installation: inputs.installation,
    resources: roles.commands,
    views: roles.views,
    changes,
    lifetime,
    readSignal: UNCANCELLED,
    unavailable: () =>
      authoringFailure('storage-unavailable', 'session', 'Workspace is closing or closed'),
    authoring,
    renderer: roles.renderer,
    exporter: exporter.invoke,
  });
}
