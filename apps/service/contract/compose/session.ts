/*
 * Why this file exists
 *
 * The HTTP routes talk to one `WorkspaceSession`. Behind it sit Authoring, the shared roles and the
 * export route, and closing it must wait for running calls before it closes the files.
 *
 * This file joins those parts into the session (core/session/facade.ts), with that close order:
 * running calls, then the change channel, then the stores. Building it reads no files.
 */
import type { Authoring } from '@novakai/canvas-authoring';
import type { NativeWorkspace, WorkspaceOptions } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { ExportRoute } from '../ports/export.js';
import type { ChangeChannel } from '../ports/notifications.js';
import type { WorkspaceSession } from '../types.js';
import { createWorkspaceSession } from '../../core/session/facade.js';
import { createSessionLifetime } from '../../core/session/lifetime.js';
import type { WorkspaceRoles } from './workspace.js';
import { UNCANCELLED } from './authoring.js';

/** What the session is built from, besides Authoring and the export route. */
export interface SessionInputs {
  readonly native: Pick<NativeWorkspace, 'close'>;
  readonly installation: BuiltinResources;
  readonly options: Pick<WorkspaceOptions, 'workspace'>;
  readonly roles: Pick<WorkspaceRoles, 'commands' | 'views' | 'renderer'>;
  readonly changes: Pick<ChangeChannel, 'subscribe' | 'close'>;
}

/**
 * Builds the session of one workspace. `authoring` makes Authoring for one request. Never fails.
 */
export function wireSession(
  inputs: SessionInputs,
  authoring: (signal: AbortSignal) => Authoring,
  exportRoute: ExportRoute,
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
    authoring,
    renderer: roles.renderer,
    exporter: exportRoute.invoke,
  });
}
