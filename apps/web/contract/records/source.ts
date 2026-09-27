import type { Snapshot, Request, Receipt } from './owners.js';
import type { EditingBase } from './editor-recovery.js';
import type { ActiveDiagram } from './active-diagram.js';
import type { Submission } from './submission.js';
import type { TransportGeneration, WorkspaceId } from '../brands.js';
import type { Result, Diagnostic } from '../errors.js';
import type { WorkspaceDecoders } from '../ports/workspace-decoders.js';
import type { RequestBuilders } from '../ports/request-builders.js';
import type { DraftRetention } from '../ports/draft-retention.js';
/** All retained source fields belong to one editor session, independent of rendered diagram updates. */
export interface SourceView {
  readonly sourceCloseRequested: boolean;
  readonly sourceOpen: boolean;
  readonly source: string;
  readonly sourceDirty: boolean;
  readonly sourceBase: SourceBase;
  readonly sourceEdit: number;
}
/**
 * What the source text was printed from or restored with: nothing before the first readout, or
 * the collection, its editing base and the generation that base was read in. One field, so a base
 * never exists without its generation and collection.
 */
export type SourceBase = { readonly kind: 'none' } | CapturedSourceBase;
/** The collection, base and generation the source text belongs to. */
export interface CapturedSourceBase {
  readonly kind: 'captured';
  readonly base: EditingBase;
  readonly generation: TransportGeneration;
  readonly collection: string;
}
export interface SourceController {
  getSnapshot(): SourceView;
  refreshReadout(): void;
  show(open: boolean): Promise<void>;
  edit(source: string): void;
  apply(): Promise<void>;
  close(decision: 'keep' | 'discard' | 'stay'): void;
  restore(workspace: WorkspaceId): void;
  confirmed(
    submission: Submission,
    receipt: Receipt,
  ): void;
  reconcile(
    snapshot: Snapshot,
    generation: TransportGeneration,
  ): void;
}
export interface SourceCallbacks {
  /** The diagram shown now; null in the library. */
  current(): ActiveDiagram | null;
  changed(view: SourceView): void;
  report(error: Diagnostic): void;
  submit(
    request: Request,
    generation: TransportGeneration,
    sourceEdit: number,
    gesture: string | null,
  ): Promise<Result<Receipt>>;
}
export interface SourceBindings extends SourceCallbacks {
  readonly inputs: Pick<WorkspaceDecoders, 'sourceRecovery'> &
    Pick<RequestBuilders, 'source' | 'dsl'>;
  readonly retention: DraftRetention;
  nextId(): string;
}
export type SourceFactory = (callbacks: SourceCallbacks) => SourceController;
