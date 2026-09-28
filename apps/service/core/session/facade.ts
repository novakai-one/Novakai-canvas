/*
 * The workspace session facade: every read, mutation, render, inspection and export runs inside
 * the session lifetime, and it owns the answers a closing or closed session gives. Pure over the
 * injected owners; compose opens them before wiring and grants no other commit path. HTTP owns
 * authentication and caller identity; the caller reconnects and retries after a closed answer.
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

/** Lifecycles are already open when wiring this facade; construction starts no I/O and grants no alternative commit path. */
export interface SessionOwners {
  readonly workspace: WorkspaceId;
  readonly builtins: PreparedBuiltins;
  readonly resources: ResourceCommands;
  readonly views: WorkspaceReader;
  readonly renderer: CollectionRenderer;
  readonly exporter: Exporter['exportFile'];
  readonly changes: Pick<ChangeChannel, 'subscribe'>;
  readonly lifetime: SessionLifetime;
  readonly readSignal: AbortSignal;
  authoring(signal: AbortSignal): Authoring;
}

/**
 * Binds one open workspace to its read, mutation, render, inspection and export calls, each run
 * inside the session lifetime. Once the session is closing or closed:
 * - `read`, `history`, `prepare`, `apply`, `receipt` answer `storage-unavailable` at `session`
 *   (`closedAuthoring`).
 * - `render`, `inspect` answer `unavailable` at `session` (`closedSession`).
 * - `exportFile` answers `unavailable` at `session`, reconnect and retry (`closedExport`).
 * While open, every failure passes through unchanged from Authoring, rendering and export.
 * `close` answers the owners' close failure, or `unavailable` (path `shutdown`) when their close throws.
 */
export function createWorkspaceSession(owners: SessionOwners): WorkspaceSession {
  const lifetime = owners.lifetime;
  return {
    workspace: owners.workspace,
    builtins: owners.builtins,
    resources: owners.resources,
    history: () =>
      lifetime.run(
        () => owners.authoring(owners.readSignal).history(owners.workspace),
        closedAuthoring,
      ),
    read: () =>
      lifetime.run(
        () => owners.authoring(owners.readSignal).read(owners.workspace),
        closedAuthoring,
      ),
    prepare: (request, signal, mode) =>
      lifetime.run(
        () => owners.authoring(signal).prepare(request, PREVIEW_FLAG[mode]),
        closedAuthoring,
      ),
    apply: (request, signal, options) =>
      lifetime.run(
        () => commitThenRead(owners.authoring(signal), owners.workspace, request, options),
        closedAuthoring,
      ),
    receipt: (request) =>
      lifetime.run(
        () => owners.authoring(owners.readSignal).receipt(owners.workspace, request),
        closedAuthoring,
      ),
    render: (id, signal) => lifetime.run(() => renderCollection(id, signal, owners), closedSession),
    inspect: (id, signal) =>
      lifetime.run(() => inspectCollection(id, signal, owners), closedSession),
    exportFile: (input, signal) => lifetime.run(() => owners.exporter(input, signal), closedExport),
    subscribe: (listener) => owners.changes.subscribe(listener),
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
