import type {
  Collection,
  DiagramObject,
  ObjectKind,
  DescendantId,
  TypeUse,
} from '@novakai/canvas-model';
import type { Snapshot, Receipt } from './owners.js';
import type { EditingBase } from './editor-recovery.js';
import type { TransportGeneration, WorkspaceId } from '../brands.js';
import type { Result, Diagnostic } from '../errors.js';
import type { DraftRetention } from '../ports/draft-retention.js';
/** UI edit commands retain incomplete text without pretending it is an admitted Model record. */
export type ObjectEdit =
  | { readonly kind: 'label' | 'role'; readonly value: string }
  | { readonly kind: 'size'; readonly value: DiagramObject['size'] }
  | { readonly kind: 'notation'; readonly value: ObjectKind }
  | {
      readonly kind: 'content-text';
      readonly id: DescendantId;
      readonly field: 'label' | 'type' | 'text' | 'returns';
      readonly value: string;
    }
  | {
      readonly kind: 'field-key';
      readonly id: DescendantId;
      readonly value: 'none' | 'primary' | 'foreign' | 'unique';
    }
  | {
      readonly kind: 'field-reference';
      readonly id: DescendantId;
      readonly target: import('@novakai/canvas-model').Endpoint;
    }
  | {
      readonly kind: 'field-type';
      readonly id: DescendantId;
      readonly value: import('@novakai/canvas-model').FieldType;
    }
  | {
      readonly kind: 'parameters';
      readonly id: DescendantId;
      readonly value: readonly (string | { readonly name: string; readonly type: TypeUse })[];
    }
  | { readonly kind: 'nullable'; readonly id: DescendantId; readonly value: boolean }
  | { readonly kind: 'remove-content'; readonly id: DescendantId }
  | {
      readonly kind: 'add-content';
      readonly id: DescendantId;
      readonly content: 'text' | 'field' | 'member' | 'signature';
    };
/** Captured scope never advances across another author's commit. Commands replay against this exact object. */
export interface ObjectDraft {
  readonly key: string;
  readonly base: EditingBase;
  readonly generation: TransportGeneration;
  readonly collection: Collection;
  readonly object: DiagramObject;
  readonly edits: readonly ObjectEdit[];
}
export interface InspectorState {
  readonly drafts: readonly ObjectDraft[];
  readonly problem: Diagnostic | null;
}
export interface ObjectSelection {
  readonly base: Snapshot;
  readonly generation: TransportGeneration;
  readonly collection: Collection;
  readonly object: DiagramObject;
}
/** Component reorganisation does not own draft lifetime. The host's inspector session does. */
export interface InspectorSession {
  getSnapshot(): InspectorState;
  subscribe(listener: () => void): () => void;
  restore(workspace: WorkspaceId): Result<void>;
  edit(
    selection: ObjectSelection,
    command: ObjectEdit,
  ): Result<void>;
  discard(key: string): Result<void>;
  apply(key: string): Promise<Result<void>>;
}
export interface InspectorBindings {
  readonly retention: DraftRetention;
  read(input: unknown): Result<readonly ObjectDraft[]>;
  apply(
    draft: ObjectDraft,
    object: DiagramObject,
  ): Promise<Result<Receipt>>;
  report(error: Diagnostic): void;
}
export type InspectorFactory = (
  callbacks: Pick<InspectorBindings, 'apply' | 'report'>,
) => InspectorSession;
