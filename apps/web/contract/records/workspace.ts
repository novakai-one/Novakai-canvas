import type { LibraryController } from './library.js';
import type { WireEditorSession } from './wire-editor.js';
import type { InspectorSession } from './inspector.js';
import type { DefinitionSession } from './definitions.js';
import type { SourceView } from './source.js';
import type { Collection, Snapshot, RenderDocument } from './owners.js';
import type { ActiveDiagram } from './active-diagram.js';
import type { ReadGeneration } from './read-generation.js';
import type { Submission } from './submission.js';
import type { Diagnostic } from '../errors.js';
import type { MoveReview } from './movement.js';
import type { AddDiagramDraft, AddGroupDraft, AddObjectDraft, CreationView } from './creation.js';
import type { ConnectionDraft, ConnectionEdit } from './connection.js';
import type { Receipt } from './owners.js';
import type { Result } from '../errors.js';
import type { BinaryResponse } from '../ports/client.js';
import type { Diagnostic as CanvasDiagnostic } from '@novakai/canvas-canvas';
export type CollectionSwitch =
  | { readonly phase: 'idle'; readonly activeId: string | null }
  | { readonly phase: 'choosing'; readonly activeId: string | null }
  | {
      readonly phase: 'loading';
      readonly activeId: string | null;
      readonly targetId: string;
    }
  | {
      readonly phase: 'failed';
      readonly activeId: string | null;
      readonly targetId: string;
      readonly problem: Diagnostic;
    };
export interface MovementReviewState {
  readonly review: MoveReview;
  readonly optionId: string;
  readonly phase: 'review' | 'sending' | 'uncertain' | 'rejected';
  readonly document: RenderDocument;
  readonly requestId?: string;
}
export interface WorkspaceView extends SourceView {
  readonly history?: {
    readonly status: import('@novakai/canvas-authoring').HistoryStatus | null;
    readonly busy: boolean;
  };
  readonly snapshot: Snapshot | null;
  readonly generation: ReadGeneration;
  readonly collections: readonly Collection[];
  readonly active: ActiveDiagram | null;
  readonly opening: string | null;
  readonly collectionSwitch: CollectionSwitch;
  readonly status: string;
  readonly problem: Diagnostic | null;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly pending: readonly Submission[];
  readonly movementReview: MovementReviewState | null;
  readonly connection: ConnectionDraft | null;
  readonly creation: CreationView;
}
/** UI actions are intentions; the runtime binds server mutations and Canvas effects at composition. */
export interface WorkspaceController {
  navigateHistory(direction: 'undo' | 'redo'): Promise<void>;
  readonly inspector: InspectorSession;
  readonly definitions: DefinitionSession;
  readonly wires: WireEditorSession;
  readonly library: LibraryController;
  getSnapshot(): WorkspaceView;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  open(id: string): Promise<void>;
  beginCollectionSwitch(): void;
  cancelCollectionSwitch(): void;
  chooseCollection(id: string): void;
  retryCollectionSwitch(): void;
  showLibrary(): void;
  refresh(): Promise<void>;
  showSource(open: boolean): Promise<void>;
  editSource(source: string): void;
  applySource(): Promise<void>;
  closeSource(decision: 'keep' | 'discard' | 'stay'): void;
  reconcileRequest(id: string): Promise<void>;
  dismissRequest(id: string): void;
  /** Hide the problem bar; the underlying drafts and pending requests are unchanged. */
  dismissProblem(): void;
  retryRequest(id: string): Promise<void>;
  create(title: string): Promise<void>;
  addDiagram(draft: AddDiagramDraft): Promise<Result<Receipt>>;
  addObject(draft: AddObjectDraft): Promise<Result<Receipt>>;
  addGroup(draft: AddGroupDraft): Promise<Result<Receipt>>;
  setDiagramDraft(draft: AddDiagramDraft): void;
  setObjectDraft(draft: AddObjectDraft): void;
  setGroupDraft(draft: AddGroupDraft): void;
  cancelCreation(kind: 'diagram' | 'object' | 'group'): void;
  editConnection(edit: ConnectionEdit): void;
  applyConnection(): Promise<Result<Receipt>>;
  cancelConnection(): void;
  exportArtifact(input: unknown): Promise<Result<BinaryResponse>>;
  report(error: Diagnostic): void;
  /** Show a failure the Canvas reported, kept as Canvas's own. */
  reportCanvas(error: CanvasDiagnostic): void;
  applyMove(optionId: string): Promise<void>;
  chooseMoveOption(optionId: string): void;
  cancelMove(): void;
  dispose(): void;
}
