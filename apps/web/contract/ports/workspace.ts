/*
 * Workspace session seams: Canvas session construction and the bindings composition hands the
 * workspace session. Declarations only; `contract/compose.ts` supplies the adapters.
 */
import type { GeometryPreview } from '@novakai/canvas-canvas';
import type { LibraryFactory } from '../records/library.js';
import type { WireEditorFactory } from '../records/wire-editor.js';
import type { InspectorFactory } from '../records/inspector.js';
import type { DefinitionFactory } from '../records/definitions.js';
import type { SourceFactory } from '../records/source.js';
import type { WorkspaceNavigation } from './navigation.js';
import type { IdSource } from './ids.js';
import type { WorkspaceDecoders } from './workspace-decoders.js';
import type { RequestBuilders } from './request-builders.js';
import type { PanelController } from '../panel-types.js';
import type { SubmissionFactory } from '../records/submission.js';
import type { Result } from '../errors.js';
import type {
  RenderDocument,
  CanvasEffect,
  Canvas,
  SessionStore,
  Change,
  EditIntent,
  SceneStamp,
} from '../records/owners.js';
import type { ServiceClient } from './client.js';
import type { EditPlanner } from '../records/editing.js';
import type { MoveOption, MoveReview } from '../records/movement.js';
/** Canvas session construction is separate from server subscriptions and browser editor state. */
export interface CanvasSessions {
  readonly canvas: Canvas;
  open(
    document: RenderDocument,
    effects: (effects: readonly CanvasEffect[]) => void,
  ): Result<SessionStore>;
  update(
    session: SessionStore,
    document: RenderDocument,
  ): Result<void>;
}
export interface WorkspaceBindings {
  readonly client: Pick<ServiceClient, 'get' | 'changes'> & Partial<Pick<ServiceClient, 'bytes'>>;
  readonly navigation: WorkspaceNavigation;
  readonly inputs: Pick<WorkspaceDecoders, 'snapshot' | 'diagram'> &
    Pick<RequestBuilders, 'model' | 'dsl' | 'newSource' | 'library' | 'history'>;
  readonly sessions: CanvasSessions;
  readonly edits: EditPlanner;
  readonly moveReview?: (
    document: RenderDocument,
    intent: Extract<EditIntent, { kind: 'placement' }>,
    stamp: SceneStamp,
  ) => Result<MoveReview>;
  readonly chooseMoveOption?: (
    review: MoveReview,
    optionId: string,
    current: SceneStamp,
  ) => Result<MoveOption>;
  readonly previewRoutes?: (
    document: RenderDocument,
    intent: EditIntent,
    changes: readonly Change[],
  ) => Result<GeometryPreview | null>;
  readonly submissions: SubmissionFactory;
  readonly source: SourceFactory;
  readonly inspector: InspectorFactory;
  readonly definitions: DefinitionFactory;
  readonly wires: WireEditorFactory;
  readonly library: LibraryFactory;
  readonly panels: Pick<PanelController, 'open' | 'restore'>;
  /** New collection IDs; a failure is reported and nothing is sent. */
  readonly ids: Pick<IdSource, 'collectionId'>;
  nextId(): string;
}
