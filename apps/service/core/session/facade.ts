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
import type {
  Authoring,
  AuthoringResult,
  HistoryStatus,
  Receipt,
  Request,
  Snapshot,
} from '../../contract/records/capability-types.js';
import type { PreparedBuiltins } from '../../contract/records/presets/builtins.js';
import type { ResourceCommands, WorkspaceReader } from '../../contract/ports/workspace.js';
import type { CollectionRenderer } from '../../contract/ports/rendering.js';
import type { ChangeChannel } from '../../contract/ports/notifications.js';
import type { Exporter } from '../../contract/ports/export.js';
import type { AppliedCommit, PrepareMode } from '../../contract/records/workspace/session.js';
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
  const authoringCalls = buildAuthoringCalls(dependencies);
  const renderAndExportCalls = buildRenderAndExportCalls(dependencies);
  return {
    workspace: dependencies.workspace,
    builtins: dependencies.builtins,
    resources: dependencies.resources,
    ...authoringCalls,
    ...renderAndExportCalls,
    subscribe: (listener) => dependencies.changes.subscribe(listener),
    close: () => dependencies.lifetime.close(),
  };
}

/** The session calls Authoring answers, with Authoring's own `Result` and codes. */
type AuthoringCalls = Pick<WorkspaceSession, 'history' | 'read' | 'prepare' | 'apply' | 'receipt'>;

/** The session calls the service answers itself, with its own `Result` and codes. */
type RenderAndExportCalls = Pick<WorkspaceSession, 'render' | 'inspect' | 'exportFile'>;

/** What Authoring's `prepare` answers: the preparation, or the receipt of an earlier save. */
type PrepareAnswer = ReturnType<Authoring['prepare']>;

/** Authoring's `preview` flag for each prepare mode. */
const PREVIEW_FLAG: Readonly<Record<PrepareMode, boolean>> = Object.freeze({
  'with-preview': true,
  'without-preview': false,
});

/** The message every closed-session answer carries. */
const CLOSED_MESSAGE = 'Workspace is closing or closed';

/** Builds the calls Authoring answers, each run only while the session is open. */
function buildAuthoringCalls(dependencies: SessionDependencies): AuthoringCalls {
  const lifetime = dependencies.lifetime;
  return {
    history: () => lifetime.run(() => readHistory(dependencies), closedAuthoringFailure),
    read: () => lifetime.run(() => readWorkspace(dependencies), closedAuthoringFailure),
    prepare: (request, signal, mode) =>
      lifetime.run(
        () => prepareChange(dependencies, request, signal, mode),
        closedAuthoringFailure,
      ),
    apply: (request, signal, options) =>
      lifetime.run(
        () => applyChange(dependencies, request, signal, options),
        closedAuthoringFailure,
      ),
    receipt: (requestId) =>
      lifetime.run(() => findReceipt(dependencies, requestId), closedAuthoringFailure),
  };
}

/** Builds render, inspect and export, each run only while the session is open. */
function buildRenderAndExportCalls(dependencies: SessionDependencies): RenderAndExportCalls {
  const lifetime = dependencies.lifetime;
  return {
    render: (collection, signal) =>
      lifetime.run(() => renderCollection(collection, signal, dependencies), closedRenderFailure),
    inspect: (collection, signal) =>
      lifetime.run(() => inspectCollection(collection, signal, dependencies), closedRenderFailure),
    exportFile: (input, signal) =>
      lifetime.run(() => dependencies.exportFile(input, signal), closedExportFailure),
  };
}

/** Reads the workspace's undo and redo status through Authoring. */
function readHistory(dependencies: SessionDependencies): Promise<AuthoringResult<HistoryStatus>> {
  const authoring = dependencies.authoring(dependencies.readSignal);
  return authoring.history(dependencies.workspace);
}

/** Reads the whole workspace through Authoring. */
function readWorkspace(dependencies: SessionDependencies): Promise<AuthoringResult<Snapshot>> {
  const authoring = dependencies.authoring(dependencies.readSignal);
  return authoring.read(dependencies.workspace);
}

/** Checks a change through Authoring without saving it, with preview images when `mode` asks. */
function prepareChange(
  dependencies: SessionDependencies,
  request: Request,
  signal: AbortSignal,
  mode: PrepareMode,
): PrepareAnswer {
  const authoring = dependencies.authoring(signal);
  const preview = PREVIEW_FLAG[mode];
  return authoring.prepare(request, preview);
}

/** Saves a change through Authoring, then reads the workspace back (see `commitThenRead`). */
function applyChange(
  dependencies: SessionDependencies,
  request: Request,
  signal: AbortSignal,
  options: unknown,
): Promise<AuthoringResult<AppliedCommit>> {
  const authoring = dependencies.authoring(signal);
  return commitThenRead(authoring, dependencies.workspace, request, options);
}

/** Finds the receipt of a request saved earlier, through Authoring. */
function findReceipt(
  dependencies: SessionDependencies,
  requestId: string | undefined,
): Promise<AuthoringResult<Receipt | null>> {
  const authoring = dependencies.authoring(dependencies.readSignal);
  return authoring.receipt(dependencies.workspace, requestId);
}

/** Makes the closed-session mistake for Authoring's calls: `storage-unavailable` at `session`. */
function closedAuthoringFailure(): AuthoringResult<never> {
  return authoringFailure('storage-unavailable', 'session', CLOSED_MESSAGE);
}

/** Makes the closed-session mistake for render and inspect: `unavailable` at `session`. */
function closedRenderFailure(): Result<never> {
  return failure('unavailable', 'session', CLOSED_MESSAGE);
}

/** Makes the closed-session mistake for export: `unavailable`, advising to reconnect and retry. */
function closedExportFailure(): Result<never> {
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
