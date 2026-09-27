import type { ResourceCommands } from './records/presets/preparation.js';
import type { SessionLifetime } from './ports/lifetime.js';
import type { Authoring, Snapshot, Receipt, AuthoringResult } from './records/capabilities.js';
import type { Preparation } from '@novakai/canvas-authoring';
import type { BuiltinResources } from './records/presets/builtins.js';
import type { WorkspaceReader } from './records/workspace/contents.js';
import type { CollectionRenderer } from './ports/collection-renderer.js';
import type { ChangeChannel, CommittedChange } from './ports/notifications.js';
import type { RenderDocument } from './records/rendering/job.js';
import type { InspectionReport } from './records/rendering/inspection.js';
import type { Result } from './errors.js';
import type { RouteOutcome } from './records/transport/protocol.js';
import type { AppliedCommit } from './records/workspace/session.js';
/** Session transport authenticates each caller before forwarding the explicit Authoring envelope. */
export interface WorkspaceSession {
  readonly workspace: string;
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
    collection: string,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
  inspect(
    collection: string,
    signal: AbortSignal,
  ): Promise<Result<InspectionReport>>;
  exportArtifact(
    input: unknown,
    signal: AbortSignal,
  ): Promise<RouteOutcome>;
  subscribe(listener: (change: CommittedChange) => void): () => void;
  close(): Promise<Result<void>>;
}
/** Lifecycles are already open when wiring this facade; construction starts no I/O and grants no alternative commit path. */
export interface SessionDependencies {
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
