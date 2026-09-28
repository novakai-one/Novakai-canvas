/*
 * The workspace session facade: every read, mutation, render, inspection and export runs inside
 * the session lifetime. Pure over the injected owners; compose opens them before wiring and grants
 * no other commit path. HTTP owns authentication and caller identity.
 */
import type { WorkspaceSession } from '../../contract/types.js';
import type { Authoring, AuthoringResult } from '../../contract/records/capabilities.js';
import type { BuiltinResources } from '../../contract/records/presets/builtins.js';
import type { ResourceCommands, WorkspaceReader } from '../../contract/ports/workspace.js';
import type { CollectionRenderer } from '../../contract/ports/rendering.js';
import type { ChangeChannel } from '../../contract/ports/notifications.js';
import type { ExportHandler } from '../../contract/ports/export.js';
import type { PrepareMode } from '../../contract/records/workspace/session.js';
import type { WorkspaceId } from '../../contract/brands.js';
import { failure, type Result } from '../../contract/errors.js';
import { renderCollection } from '../rendering/collection.js';
import { inspectCollection } from '../rendering/inspection.js';
import type { SessionLifetime } from './lifetime.js';
import { commitThenRead } from './applied-commit.js';

/** Lifecycles are already open when wiring this facade; construction starts no I/O and grants no alternative commit path. */
export interface SessionOwners {
  readonly workspace: WorkspaceId;
  readonly installation: BuiltinResources;
  readonly resources: ResourceCommands;
  readonly views: WorkspaceReader;
  readonly renderer: CollectionRenderer;
  readonly exporter: ExportHandler['invoke'];
  readonly changes: Pick<ChangeChannel, 'subscribe'>;
  readonly lifetime: SessionLifetime;
  readonly readSignal: AbortSignal;
  unavailable(): AuthoringResult<never>;
  authoring(signal: AbortSignal): Authoring;
}

/**
 * Binds one open workspace to its read, mutation, render, inspection and export calls, each run
 * inside the session lifetime. Once the session is closing or closed:
 * - `read`, `history`, `prepare`, `apply`, `receipt` answer `owners.unavailable()` (compose returns
 *   `storage-unavailable`, path `session`).
 * - `render`, `inspect`, `exportArtifact` answer `unavailable` (path `session`).
 * While open, every failure passes through unchanged from Authoring, rendering and export.
 * `close` answers the owners' close failure, or `unavailable` (path `shutdown`) when their close throws.
 */
export function createWorkspaceSession(owners: SessionOwners): WorkspaceSession {
  const lifetime = owners.lifetime;
  return {
    workspace: owners.workspace,
    installation: owners.installation,
    resources: owners.resources,
    history: () =>
      lifetime.run(
        () => owners.authoring(owners.readSignal).history(owners.workspace),
        owners.unavailable,
      ),
    read: () =>
      lifetime.run(
        () => owners.authoring(owners.readSignal).read(owners.workspace),
        owners.unavailable,
      ),
    prepare: (request, signal, mode) =>
      lifetime.run(
        () => owners.authoring(signal).prepare(request, PREVIEW_FLAG[mode]),
        owners.unavailable,
      ),
    apply: (request, signal, options) =>
      lifetime.run(
        () => commitThenRead(owners.authoring(signal), owners.workspace, request, options),
        owners.unavailable,
      ),
    receipt: (request) =>
      lifetime.run(
        () => owners.authoring(owners.readSignal).receipt(owners.workspace, request),
        owners.unavailable,
      ),
    render: (id, signal) =>
      lifetime.run(
        () => renderCollection(id, signal, owners),
        () => failure('unavailable', 'session', 'Workspace is closing or closed'),
      ),
    inspect: (id, signal) =>
      lifetime.run(
        () => inspectCollection(id, signal, owners),
        () => failure('unavailable', 'session', 'Workspace is closing or closed'),
      ),
    exportArtifact: (input, signal) =>
      lifetime.run(
        () => owners.exporter(input, signal),
        () => unavailableExport(),
      ),
    subscribe: (listener) => owners.changes.subscribe(listener),
    close: () => lifetime.close(),
  };
}

/** Authoring's `preview` flag for each prepare mode. */
const PREVIEW_FLAG: Readonly<Record<PrepareMode, boolean>> = Object.freeze({
  'with-preview': true,
  'without-preview': false,
});

/** The export answer while the session is closing or closed: `unavailable`, reconnect and retry. */
function unavailableExport(): Result<never> {
  return {
    ok: false,
    error: {
      code: 'unavailable',
      path: 'session',
      message: 'Workspace is closing or closed',
      recovery: 'Reconnect and retry the export.',
    },
  };
}
