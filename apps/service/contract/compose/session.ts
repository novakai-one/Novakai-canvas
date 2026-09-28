/*
 * Why this file exists
 *
 * The HTTP routes talk to one `WorkspaceSession`. Behind it sit Authoring, the shared parts
 * (compose/shared-parts.ts) and the exporter (ports/export.ts). Closing it must not cut off a
 * call that is still running.
 *
 * This file joins those parts into the session (core/session/facade.ts). Closing waits for running
 * calls, then closes the change channel, then the stores. Building it reads no files.
 */
import type { Authoring } from '@novakai/canvas-authoring';
import type { OpenStores, WorkspaceOptions } from '../records/workspace/startup.js';
import type { PreparedBuiltins } from '../records/presets/builtins.js';
import type { Exporter } from '../ports/export.js';
import type { ChangeChannel } from '../ports/notifications.js';
import type { WorkspaceSession } from '../types.js';
import { createWorkspaceSession } from '../../core/session/facade.js';
import { createSessionLifetime } from '../../core/session/lifetime.js';
import type { SharedParts } from './shared-parts.js';
import { UNCANCELLED } from './authoring.js';

/** What the session is built from, besides Authoring and the exporter. */
export interface SessionInputs {
  /** The workspace's open stores; the session closes them last. */
  readonly stores: Pick<OpenStores, 'close'>;
  readonly builtins: PreparedBuiltins;
  readonly options: Pick<WorkspaceOptions, 'workspace'>;
  readonly shared: Pick<SharedParts, 'commands' | 'reader' | 'renderer'>;
  readonly changes: Pick<ChangeChannel, 'subscribe' | 'close'>;
}

/**
 * Builds the session of one workspace. `authoring` makes Authoring for one request. Never fails.
 */
export function buildSession(
  inputs: SessionInputs,
  authoring: (signal: AbortSignal) => Authoring,
  exporter: Exporter,
): WorkspaceSession {
  const { stores, changes, shared } = inputs;
  const lifetime = createSessionLifetime(async () => {
    changes.close();
    return stores.close();
  });
  return createWorkspaceSession({
    workspace: inputs.options.workspace,
    builtins: inputs.builtins,
    resources: shared.commands,
    reader: shared.reader,
    changes,
    lifetime,
    readSignal: UNCANCELLED,
    authoring,
    renderer: shared.renderer,
    exportFile: exporter.exportFile,
  });
}
