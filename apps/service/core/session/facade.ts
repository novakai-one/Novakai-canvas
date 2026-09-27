/*
 * The workspace session facade: every read, mutation, render, inspection and export runs inside
 * the session lifetime. Pure over the injected owners; compose opens them before wiring and grants
 * no other commit path. HTTP owns authentication and caller identity.
 */
import type { WorkspaceSession } from '../../contract/types.js';
import type { Authoring, AuthoringResult } from '../../contract/records/capabilities.js';
import type { BuiltinResources } from '../../contract/records/presets/builtins.js';
import type { ResourceCommands } from '../../contract/records/presets/preparation.js';
import type { WorkspaceReader } from '../../contract/records/workspace/contents.js';
import type { CollectionRenderer } from '../../contract/ports/collection-renderer.js';
import type { ChangeChannel } from '../../contract/ports/notifications.js';
import type { RouteOutcome } from '../../contract/records/transport/protocol.js';
import { failure } from '../../contract/errors.js';
import { renderCollection } from '../rendering/collection.js';
import { inspectCollection } from '../rendering/inspection.js';
import type { SessionLifetime } from './lifetime.js';
import { commitThenRead } from './applied-commit.js';

/** Lifecycles are already open when wiring this facade; construction starts no I/O and grants no alternative commit path. */
export interface SessionOwners {
  readonly workspace: string;
  readonly installation: BuiltinResources;
  readonly resources: ResourceCommands;
  readonly views: WorkspaceReader;
  readonly renderer: CollectionRenderer;
  readonly exporter: (input: unknown, signal: AbortSignal) => Promise<RouteOutcome>;
  readonly changes: ChangeChannel;
  readonly lifetime: SessionLifetime;
  readonly readSignal: AbortSignal;
  unavailable(): AuthoringResult<never>;
  authoring(signal: AbortSignal): Authoring;
}

/** Bind a persistent workspace to read, mutation and render consumers; HTTP owns authentication and caller identity. */
export function createWorkspaceSession(dependencies: SessionOwners): WorkspaceSession {
  const lifetime = dependencies.lifetime;
  return {
    workspace: dependencies.workspace,
    installation: dependencies.installation,
    resources: dependencies.resources,
    history: () =>
      lifetime.run(
        () => dependencies.authoring(dependencies.readSignal).history(dependencies.workspace),
        dependencies.unavailable,
      ),
    read: () =>
      lifetime.run(
        () => dependencies.authoring(dependencies.readSignal).read(dependencies.workspace),
        dependencies.unavailable,
      ),
    prepare: (request, signal, preview = false) =>
      lifetime.run(
        () => dependencies.authoring(signal).prepare(request, preview),
        dependencies.unavailable,
      ),
    apply: (request, signal, options = {}) =>
      lifetime.run(
        () =>
          commitThenRead(dependencies.authoring(signal), dependencies.workspace, request, options),
        dependencies.unavailable,
      ),
    receipt: (request) =>
      lifetime.run(
        () =>
          dependencies.authoring(dependencies.readSignal).receipt(dependencies.workspace, request),
        dependencies.unavailable,
      ),
    render: (id, signal) =>
      lifetime.run(
        () => renderCollection(id, signal, dependencies),
        () => failure('unavailable', 'session', 'Workspace is closing or closed'),
      ),
    inspect: (id, signal) =>
      lifetime.run(
        () => inspectCollection(id, signal, dependencies),
        () => failure('unavailable', 'session', 'Workspace is closing or closed'),
      ),
    exportArtifact: (input, signal) =>
      lifetime.run(
        () => dependencies.exporter(input, signal),
        () => unavailableExport(),
      ),
    subscribe: (listener) => dependencies.changes.subscribe(listener),
    close: () => lifetime.close(),
  };
}

/** The export answer while the session is closing or closed: `unavailable`, reconnect and retry. */
function unavailableExport(): RouteOutcome {
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
