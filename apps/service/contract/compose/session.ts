/*
 * Why this file exists
 *
 * The HTTP routes talk to one `WorkspaceSession`. Behind it sit Authoring, the shared helpers
 * ("roles", compose/workspace.ts) and the exporter (ports/export.ts), and closing it must wait for
 * running calls before it closes the files.
 *
 * This file joins those parts into the session (core/session/facade.ts), with that close order:
 * running calls, then the change channel, then the stores. Building it reads no files.
 */
import type { Authoring } from '@novakai/canvas-authoring';
import type { OpenStores, WorkspaceOptions } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { Exporter } from '../ports/export.js';
import type { ChangeChannel } from '../ports/notifications.js';
import type { WorkspaceSession } from '../types.js';
import { createWorkspaceSession } from '../../core/session/facade.js';
import { createSessionLifetime } from '../../core/session/lifetime.js';
import type { WorkspaceRoles } from './workspace.js';
import { UNCANCELLED } from './authoring.js';

/** What the session is built from, besides Authoring and the exporter. */
export interface SessionInputs {
  /** The workspace's open stores; the session closes them last. */
  readonly stores: Pick<OpenStores, 'close'>;
  readonly builtins: BuiltinResources;
  readonly options: Pick<WorkspaceOptions, 'workspace'>;
  readonly roles: Pick<WorkspaceRoles, 'commands' | 'reader' | 'renderer'>;
  readonly changes: Pick<ChangeChannel, 'subscribe' | 'close'>;
}

/**
 * Builds the session of one workspace. `authoring` makes Authoring for one request. Never fails.
 */
export function wireSession(
  inputs: SessionInputs,
  authoring: (signal: AbortSignal) => Authoring,
  exporter: Exporter,
): WorkspaceSession {
  const { stores, changes, roles } = inputs;
  const lifetime = createSessionLifetime(async () => {
    changes.close();
    return stores.close();
  });
  return createWorkspaceSession({
    workspace: inputs.options.workspace,
    builtins: inputs.builtins,
    resources: roles.commands,
    views: roles.reader,
    changes,
    lifetime,
    readSignal: UNCANCELLED,
    authoring,
    renderer: roles.renderer,
    exporter: exporter.exportFile,
  });
}
