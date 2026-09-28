import type { Snapshot, Request, Receipt } from './owners.js';
import type { RecoveredSource } from './editor-recovery.js';
import type { ActiveDiagram } from './active-diagram.js';
import type { Submission } from './submission.js';
import type {
  GestureId,
  PlannerId,
  SourceEdit,
  TransportGeneration,
  WorkspaceId,
} from '../brands.js';
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
  readonly sourceEdit: SourceEdit;
}
/**
 * What the source text was printed from or restored with: nothing before the first readout, or
 * the collection, its editing base and the generation that base was read in. One field, so a base
 * never exists without its generation and collection.
 */
export type SourceBase = { readonly kind: 'none' } | CapturedSourceBase;
/** The collection, base and generation the source text belongs to: a recovered draft's own fields. */
export interface CapturedSourceBase extends Pick<
  RecoveredSource,
  'base' | 'generation' | 'collection'
> {
  readonly kind: 'captured';
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
    sourceEdit: SourceEdit,
    gesture: GestureId | null,
  ): Promise<Result<Receipt>>;
}
export interface SourceBindings extends SourceCallbacks {
  readonly inputs: Pick<WorkspaceDecoders, 'sourceRecovery'> & Pick<RequestBuilders, 'source'>;
  readonly retention: DraftRetention;
  /** The planner every source request names: the request identity's DSL planner. */
  readonly dslPlanner: PlannerId;
  /**
   * `source` as a DSL replace request of `captured`'s collection, under a new request ID from the
   * ID source. Fails with `id-unavailable` (nothing is built) or as the DSL builder does.
   */
  replaceRequest(
    captured: CapturedSourceBase,
    source: string,
  ): Result<Request>;
}
export type SourceFactory = (callbacks: SourceCallbacks) => SourceController;
