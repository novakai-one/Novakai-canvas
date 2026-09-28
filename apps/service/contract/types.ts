/*
 * The session facade type, shared by the core facade, the HTTP router and compose. Declaration
 * only; core/session/facade.ts implements it.
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
/** Session transport authenticates each caller before forwarding the explicit Authoring envelope. */
export interface WorkspaceSession {
  readonly workspace: WorkspaceId;
  readonly installation: BuiltinResources;
  readonly resources: ResourceCommands;
  read(): Promise<AuthoringResult<Snapshot>>;
  history(): Promise<AuthoringResult<HistoryStatus>>;
  prepare(
    request: Request,
    signal: AbortSignal,
    mode: PrepareMode,
  ): Promise<AuthoringResult<Preparation | Receipt>>;
  /** `options` are untrusted apply options; Authoring parses them. */
  apply(
    request: Request,
    signal: AbortSignal,
    options: unknown,
  ): Promise<AuthoringResult<AppliedCommit>>;
  /** The request ID is untrusted query text; Authoring parses it. */
  receipt(request: unknown): Promise<AuthoringResult<Receipt | null>>;
  render(
    collection: CollectionId,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
  inspect(
    collection: CollectionId,
    signal: AbortSignal,
  ): Promise<Result<InspectionReport>>;
  /** One export file; the input is untrusted and the export route parses it. */
  exportArtifact(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Result<StaticFile>>;
  subscribe(listener: (change: CommittedChange) => void): () => void;
  close(): Promise<Result<void>>;
}
