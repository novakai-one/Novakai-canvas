import type {
  Collection,
  Section,
  WireAppearance,
  Relationship,
  Endpoint,
  Change,
} from './owners.js';
import type { Snapshot, Receipt } from './owners.js';
import type { EditingBase } from './editor-recovery.js';
import type { Diagnostic, Result } from '../errors.js';
import type { DraftRetention } from '../ports/draft-retention.js';
/** The semantic relationship is shared; only the selected section owns the route controls. */
export interface WireSelection {
  readonly base: Snapshot;
  readonly generation: string;
  readonly collection: Collection;
  readonly section: Section;
  readonly relationship: Relationship;
  readonly wire: WireAppearance;
}
/** Incomplete text is a retained UI intention, not an admitted relationship. */
export type WireEdit =
  | { readonly kind: 'label' | 'guard' | 'effect'; readonly value: string }
  | { readonly kind: 'relationship-kind'; readonly value: Relationship['kind'] }
  | { readonly kind: 'style'; readonly value: Relationship['style'] }
  | { readonly kind: 'endpoint'; readonly side: 'source' | 'target'; readonly value: Endpoint }
  | {
      readonly kind: 'cardinality';
      readonly side: 'from' | 'to';
      readonly value: NonNullable<Relationship['from']> | 'none';
    }
  | { readonly kind: 'route'; readonly value: WireAppearance['route'] }
  | { readonly kind: 'locked'; readonly value: boolean }
  | {
      readonly kind: 'side';
      readonly side: 'sourceSide' | 'targetSide';
      readonly value: WireAppearance['sourceSide'];
    }
  | { readonly kind: 'automatic-route' };
export interface WireDraft extends Omit<WireSelection, 'base'> {
  readonly base: EditingBase;
  readonly key: string;
  readonly edits: readonly WireEdit[];
}
export interface EditedWire {
  readonly relationship: Relationship;
  readonly wire: WireAppearance;
}
/** One endpoint a person can pick in the wire editor; `value` is the endpoint's stable select key. */
export interface EndpointChoice {
  readonly value: string;
  readonly label: string;
  readonly endpoint: Endpoint;
}
export interface WireEditorState {
  readonly drafts: readonly WireDraft[];
  readonly problem: Diagnostic | null;
}
/** Retained wire forms have their own lifecycle; reorganizing panels cannot clear them. */
export interface WireEditorSession {
  getSnapshot(): WireEditorState;
  subscribe(listener: () => void): () => void;
  restore(workspace: string): Result<void>;
  edit(
    selection: WireSelection,
    command: WireEdit,
  ): Result<void>;
  discard(key: string): Result<void>;
  apply(key: string): Promise<Result<void>>;
}
export interface WireEditorBindings {
  readonly retention: DraftRetention;
  read(input: unknown): Result<readonly WireDraft[]>;
  apply(
    draft: WireDraft,
    changes: readonly Change[],
  ): Promise<Result<Receipt>>;
  report(error: Diagnostic): void;
}
export type WireEditorFactory = (
  callbacks: Pick<WireEditorBindings, 'apply' | 'report'>,
) => WireEditorSession;
