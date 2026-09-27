import type { Snapshot, Request, Receipt } from './owners.js';
import type { EditingBase } from './editor-recovery.js';
import type { ActiveDiagram } from './active-diagram.js';
import type { Submission } from './submission.js';
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
  readonly sourceBase: EditingBase | null;
  readonly sourceGeneration: string;
  readonly sourceCollection: string;
  readonly sourceEdit: number;
}
export interface SourceController {
  getSnapshot(): SourceView;
  refreshReadout(): void;
  show(open: boolean): Promise<void>;
  edit(source: string): void;
  apply(): Promise<void>;
  close(decision: 'keep' | 'discard' | 'stay'): void;
  restore(workspace: string): void;
  confirmed(
    submission: Submission,
    receipt: Receipt,
  ): void;
  reconcile(
    snapshot: Snapshot,
    generation: string,
  ): void;
}
export interface SourceCallbacks {
  current(): { readonly active: ActiveDiagram | null; readonly generation: string };
  changed(view: SourceView): void;
  report(error: Diagnostic): void;
  submit(
    request: Request,
    generation: string,
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
