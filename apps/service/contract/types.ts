/*
 * The session facade type, shared by the core facade, the HTTP router and compose. Declaration
 * only; core/session/facade.ts implements it.
 */
import type { ResourceCommands } from './ports/workspace.js';
import type { Authoring, Snapshot, Receipt, AuthoringResult } from './records/capabilities.js';
import type { Preparation } from '@novakai/canvas-authoring';
import type { BuiltinResources } from './records/presets/builtins.js';
import type { CommittedChange } from './ports/notifications.js';
import type { RenderDocument } from './records/rendering/job.js';
import type { InspectionReport } from './records/rendering/inspection.js';
import type { Result } from './errors.js';
import type { RouteOutcome } from './records/transport/protocol.js';
import type { AppliedCommit } from './records/workspace/session.js';
import type { CollectionId, WorkspaceId } from './brands.js';
/** Session transport authenticates each caller before forwarding the explicit Authoring envelope. */
export interface WorkspaceSession {
  readonly workspace: WorkspaceId;
  readonly installation: BuiltinResources;
  readonly resources: ResourceCommands;
  read(): Promise<AuthoringResult<Snapshot>>;
  history(): ReturnType<Authoring['history']>;
  prepare(
    request: unknown,
    signal: AbortSignal,
    preview?: boolean,
  ): Promise<AuthoringResult<Preparation | Receipt>>;
  apply(
    request: unknown,
    signal: AbortSignal,
    options?: unknown,
  ): Promise<AuthoringResult<AppliedCommit>>;
  receipt(request: unknown): Promise<AuthoringResult<Receipt | null>>;
  render(
    collection: CollectionId,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
  inspect(
    collection: CollectionId,
    signal: AbortSignal,
  ): Promise<Result<InspectionReport>>;
  exportArtifact(
    input: unknown,
    signal: AbortSignal,
  ): Promise<RouteOutcome>;
  subscribe(listener: (change: CommittedChange) => void): () => void;
  close(): Promise<Result<void>>;
}
