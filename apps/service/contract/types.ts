/*
 * Why this file exists
 *
 * Once a workspace is open, many parts of the service use it. The HTTP routes read it, save changes
 * and render it; start-up checks it; shutdown closes it. None of them should need to know how it
 * was built. For example, `GET /api/v1/render?id=my-diagram` becomes
 * `session.render('my-diagram', signal)`.
 *
 * This file declares what one open workspace answers: `WorkspaceSession`. Each call answers with a
 * `Result` (see `errors.ts`); the calls Authoring answers use Authoring's own `Result` and codes.
 * It never checks who is calling: HTTP admission did that first.
 */
import type { ResourceCommands } from './ports/workspace.js';
import type {
  HistoryStatus,
  Snapshot,
  Receipt,
  AuthoringResult,
  Request,
} from './records/capabilities.js';
import type { Preparation } from '@novakai/canvas-authoring';
import type { BuiltinResources } from './records/presets/builtins.js';
import type { CommittedChange } from './ports/notifications.js';
import type { RenderDocument } from './records/rendering/job.js';
import type { InspectionReport } from './records/rendering/inspection.js';
import type { Result } from './errors.js';
import type { StaticFile } from './records/transport/server.js';
import type { AppliedCommit, PrepareMode } from './records/workspace/session.js';
import type { CollectionId, WorkspaceId } from './brands.js';
/**
 * One open workspace and everything the service can ask of it. Each call runs only while the
 * session is open; `close` waits for calls already running, then closes the workspace.
 */
export interface WorkspaceSession {
  /** The workspace's ID. `pnpm dev` always opens `local`. */
  readonly workspace: WorkspaceId;
  /**
   * The shipped fonts, design tokens and recipe starters, and the preset catalog made from them.
   */
  readonly installation: BuiltinResources;
  /** Upload, restore and read stored files; prepare themes and recipes (see `ResourceCommands`). */
  readonly resources: ResourceCommands;
  /**
   * Reads the whole workspace as Authoring has it now: every stored record and its version. Fails
   * with Authoring's codes, or `storage-unavailable` at `session` once the session is closing.
   */
  read(): Promise<AuthoringResult<Snapshot>>;
  /**
   * Reads the workspace's undo and redo status. Fails like `read`.
   */
  history(): Promise<AuthoringResult<HistoryStatus>>;
  /**
   * Checks a change without saving it. Authoring plans it and, for `with-preview`, also renders
   * the preview images. Answers the preparation, or the receipt if this request was already saved.
   * Fails with Authoring's codes (for example `revision-conflict`), or like `read` once closing.
   */
  prepare(
    request: Request,
    signal: AbortSignal,
    mode: PrepareMode,
  ): Promise<AuthoringResult<Preparation | Receipt>>;
  /**
   * Saves a change through Authoring, then reads the workspace back, so the caller gets the new
   * workspace without a second request. `options` are the apply options as sent (for example the
   * `candidateHash` from `prepare`); Authoring checks them. Fails with Authoring's codes, or
   * `storage-unavailable` at `snapshot` when the change was saved but the read-back failed.
   */
  apply(
    request: Request,
    signal: AbortSignal,
    options: unknown,
  ): Promise<AuthoringResult<AppliedCommit>>;
  /**
   * Finds the receipt of a request saved earlier, or `null` if none is stored. `requestId` is the
   * text as sent in the query; Authoring checks it. Fails like `read`.
   */
  receipt(requestId: unknown): Promise<AuthoringResult<Receipt | null>>;
  /**
   * Lays out one saved collection: measured text, placed nodes and routed wires. Fails with
   * `not-found` when no collection has this ID, `unavailable` when the workspace can't be read or
   * the render worker can't finish, and `cancelled` when `signal` aborts. Other render failures
   * pass through (see `CollectionRenderer`).
   */
  render(
    collection: CollectionId,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
  /**
   * Renders one saved collection and reports its quality: warnings and counts, or why it could not
   * be rendered. Fails like `render` when the collection is missing or the workspace can't be read.
   */
  inspect(
    collection: CollectionId,
    signal: AbortSignal,
  ): Promise<Result<InspectionReport>>;
  /**
   * Makes one export file (DSL, Markdown, SVG or PNG) from the request as sent; the export route
   * checks it. Fails with `invalid-input` for a bad request, `unavailable` when a file can't be
   * read or encoded, and `cancelled` when `signal` aborts (see `ExportRoute`).
   */
  exportArtifact(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Result<StaticFile>>;
  /**
   * Calls `listener` after every saved change. Returns the function that stops listening.
   */
  subscribe(listener: (change: CommittedChange) => void): () => void;
  /**
   * Waits for calls already running, then closes the change stream and the workspace files. Every
   * later call gets the same answer. Fails with the files' own close failure, or `unavailable` at
   * `shutdown`.
   */
  close(): Promise<Result<void>>;
}
