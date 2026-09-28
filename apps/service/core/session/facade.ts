/*
 * Why this file exists
 *
 * The routes need one object for everything they ask of the open workspace: read it, save a change,
 * render, export. Shutdown must refuse new calls but not cut off a call that is still running. For
 * example, `GET /api/v1/render?id=my-diagram` becomes `session.render('my-diagram', signal)`; once
 * the server is closing, it answers "Workspace is closing or closed" instead of starting.
 *
 * This file builds that `WorkspaceSession` from parts already opened at startup
 * (contract/compose/session.ts). Every call runs through the session's lifetime (lifetime.ts). It
 * never opens files or checks who is calling.
 */
import type { WorkspaceSession } from '../../contract/types.js';
import type { Authoring, AuthoringResult } from '../../contract/records/capability-types.js';
import type { PreparedBuiltins } from '../../contract/records/presets/builtins.js';
import type { ResourceCommands, WorkspaceReader } from '../../contract/ports/workspace.js';
import type { CollectionRenderer } from '../../contract/ports/rendering.js';
import type { ChangeChannel } from '../../contract/ports/notifications.js';
import type { Exporter } from '../../contract/ports/export.js';
import type { PrepareMode } from '../../contract/records/workspace/session.js';
import type { WorkspaceId } from '../../contract/brands.js';
import { authoringFailure, failure, type Result } from '../../contract/errors.js';
import { renderCollection } from '../rendering/collection.js';
import { inspectCollection } from '../rendering/inspection.js';
import type { SessionLifetime } from './lifetime.js';
import { commitThenRead } from './applied-commit.js';

/** The already-open parts the session is built from. Building the session starts no I/O. */
export interface SessionDependencies {
  /** The workspace's ID. */
  readonly workspace: WorkspaceId;
  /** The shipped fonts, design tokens and built-in presets, handed on as they are. */
  readonly builtins: PreparedBuiltins;
  /** The commands behind `/api/v1/resources/…`, handed on as they are. */
  readonly resources: ResourceCommands;
  /** Reads the saved workspace's checked collections, catalog and presets (workspace/reader.ts). */
  readonly reader: WorkspaceReader;
  /** Renders one checked collection. */
  readonly renderer: CollectionRenderer;
  /** Makes one export file (see `Exporter`). */
  readonly exportFile: Exporter['exportFile'];
  /** Where saved changes are announced. */
  readonly changes: Pick<ChangeChannel, 'subscribe'>;
  /** Runs calls only while the session is open, and closes the workspace once (lifetime.ts). */
  readonly lifetime: SessionLifetime;
  /** The signal reads run under; startup passes one that never aborts. */
  readonly readSignal: AbortSignal;
  /** Makes Authoring for one call; that call stops when `signal` aborts. */
  authoring(signal: AbortSignal): Authoring;
}

/**
 * Builds the session of one open workspace. Each call runs only while the session is open.
 * Once it is closing, the calls Authoring answers (`read`, `apply`, …) give `storage-unavailable`,
 * and `render`, `inspect` and `exportFile` give `unavailable`. Otherwise failures pass through.
 */
export function createWorkspaceSession(dependencies: SessionDependencies): WorkspaceSession {
  const lifetime = dependencies.lifetime;
  return {
    workspace: dependencies.workspace,
    builtins: dependencies.builtins,
    resources: dependencies.resources,
    history: () =>
      lifetime.run(
        () => dependencies.authoring(dependencies.readSignal).history(dependencies.workspace),
        closedAuthoring,
      ),
    read: () =>
      lifetime.run(
        () => dependencies.authoring(dependencies.readSignal).read(dependencies.workspace),
        closedAuthoring,
      ),
    prepare: (request, signal, mode) =>
      lifetime.run(
        () => dependencies.authoring(signal).prepare(request, PREVIEW_FLAG[mode]),
        closedAuthoring,
      ),
    apply: (request, signal, options) =>
      lifetime.run(
        () =>
          commitThenRead(dependencies.authoring(signal), dependencies.workspace, request, options),
        closedAuthoring,
      ),
    receipt: (request) =>
      lifetime.run(
        () =>
          dependencies.authoring(dependencies.readSignal).receipt(dependencies.workspace, request),
        closedAuthoring,
      ),
    render: (id, signal) =>
      lifetime.run(() => renderCollection(id, signal, dependencies), closedSession),
    inspect: (id, signal) =>
      lifetime.run(() => inspectCollection(id, signal, dependencies), closedSession),
    exportFile: (input, signal) =>
      lifetime.run(() => dependencies.exportFile(input, signal), closedExport),
    subscribe: (listener) => dependencies.changes.subscribe(listener),
    close: () => lifetime.close(),
  };
}

/** Authoring's `preview` flag for each prepare mode. */
const PREVIEW_FLAG: Readonly<Record<PrepareMode, boolean>> = Object.freeze({
  'with-preview': true,
  'without-preview': false,
});

/** The message every closed-session answer carries. */
const CLOSED_MESSAGE = 'Workspace is closing or closed';

/** The Authoring answer while the session is closing or closed: `storage-unavailable` at `session`. */
function closedAuthoring(): AuthoringResult<never> {
  return authoringFailure('storage-unavailable', 'session', CLOSED_MESSAGE);
}

/** The render and inspect answer while the session is closing or closed: `unavailable` at `session`. */
function closedSession(): Result<never> {
  return failure('unavailable', 'session', CLOSED_MESSAGE);
}

/** The export answer while the session is closing or closed: `unavailable`, reconnect and retry. */
function closedExport(): Result<never> {
  return {
    ok: false,
    error: {
      code: 'unavailable',
      path: 'session',
      message: CLOSED_MESSAGE,
      recovery: 'Reconnect and retry the export.',
    },
  };
}
