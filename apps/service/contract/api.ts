import type { SessionDependencies, WorkspaceSession } from './types.js';
import { failure } from './errors.js';
import { failure as commitFailure } from '@novakai/canvas-authoring';
import { renderCollection } from '../core/rendering/collection.js';
import { inspectCollection } from '../core/rendering/inspection.js';
import type { RouteOutcome } from './records/protocol.js';
import type { Authoring, AuthoringResult } from './records/owners.js';
import type { AppliedCommit } from './records/applied-commit.js';
import { historyVersionsOnly } from '../core/workspace/history-versions.js';
export { createAdmission as createHttpAdmission } from '../core/transport/admission.js';
export { readCommand } from '../core/transport/command.js';
export { readExportRequest } from '../core/export/request.js';
export {
  cancelledExport,
  exportRejection,
  exportRouteFailure,
  releaseOutcome,
  settledFailure,
} from '../core/export/faults.js';
export {
  exportSnapshot,
  renderedDocument,
  selectedCollection,
  workspaceSnapshot,
} from '../core/export/snapshot.js';
export { resourceInspector } from '../core/export/resources.js';
export { validReport } from '../core/rendering/inspection.js';
export { artifactOutcome, dslFile, markdownFile } from '../core/export/files.js';
export { historyVersionsOnly } from '../core/workspace/history-versions.js';
/** Bind a persistent workspace to read, mutation and render consumers; HTTP owns authentication and caller identity. */
export function createWorkspaceSession(dependencies: SessionDependencies): WorkspaceSession {
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

/**
 * Commit, then read the post-commit workspace from the same owner, with history contents stripped as the
 * workspace route strips them. A failed read is the result, yet the commit stands: its receipt is durable
 * and the client reconciles through the receipt lookup.
 */
async function commitThenRead(
  authoring: Authoring,
  workspace: string,
  request: unknown,
  options: unknown,
): Promise<AuthoringResult<AppliedCommit>> {
  const committed = await authoring.apply(request, options);
  if (!committed.ok) return committed;
  const committedWorkspace = await authoring.read(workspace);
  if (!committedWorkspace.ok) return carriedSnapshotUnread();
  return {
    ok: true,
    value: { receipt: committed.value, snapshot: historyVersionsOnly(committedWorkspace.value) },
  };
}

/** A committed edit is never a refusal: a failed snapshot read leaves the receipt durable and the fate uncertain, so the client reconciles the receipt instead of dropping the write. */
function carriedSnapshotUnread(): AuthoringResult<never> {
  return commitFailure(
    'storage-unavailable',
    'snapshot',
    'The edit committed, but the new workspace could not be read',
  );
}

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

export { projectCollection } from '../core/workspace/projection.js';
