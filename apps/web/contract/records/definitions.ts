/*
 * Definitions vocabulary: the retained draft session, the expression parts the panel edits, and
 * the panel view Web core builds for the React adapters. Model's definition types come in through
 * this module because Web core may not import a capability directly.
 */
import type {
  Definition,
  Collection,
  DefinitionUsage,
  Result as ModelResult,
  TypeExpression,
} from '@novakai/canvas-model';
import type { Snapshot, Receipt, Request, CanvasEvent, NodeTarget } from './owners.js';
import type { EditingBase } from './editor-recovery.js';
import type {
  DefinitionDraftKey,
  DefinitionId,
  DescendantId,
  ObjectId,
  RequestId,
  TransportGeneration,
  WorkspaceId,
} from '../brands.js';
import type { Diagnostic, Result } from '../errors.js';
import type { DraftRetention } from '../ports/draft-retention.js';

export type { Definition, DefinitionId, DefinitionUsage, TypeExpression };

export interface DefinitionSelection {
  readonly base: Snapshot;
  readonly generation: TransportGeneration;
  readonly collection: Collection;
}

export interface DefinitionDraft {
  readonly key: DefinitionDraftKey;
  readonly base: EditingBase;
  readonly generation: TransportGeneration;
  readonly collection: Collection;
  readonly definition: Definition;
  readonly operation: 'create' | 'replace' | 'remove';
  readonly request?: Request | undefined;
  readonly literalDrafts?: readonly LiteralDraft[] | undefined;
}

export interface LiteralDraft {
  readonly path: ExpressionPath;
  readonly kind: LiteralKind;
  readonly text: string;
}

/** A node's position in an expression: the union item index at each level, from the root. */
export type ExpressionPath = readonly number[];
export type UnionExpression = Extract<TypeExpression, { kind: 'union' }>;
export type PrimitiveExpression = Extract<TypeExpression, { kind: 'primitive' }>;
export type ReferenceExpression = Extract<TypeExpression, { kind: 'reference' }>;
export type LiteralExpression = Extract<TypeExpression, { kind: 'literal' }>;
export type PrimitiveName = PrimitiveExpression['name'];
export type LiteralValue = LiteralExpression['value'];
export type LiteralKind = 'string' | 'number' | 'boolean';

/** Model's answers for one definition: its uses, and its canonical text. */
export type UsageOutcome = ModelResult<readonly DefinitionUsage[]>;
export type DisplayOutcome = ModelResult<string>;

/** The canvas event that selects a usage's node. */
export type UsageSelection = Extract<CanvasEvent, { kind: 'select' }>;

/** One listed use: a field names its object and field and the node showing it, if any. */
export type UsageItem =
  | {
      readonly kind: 'field';
      readonly key: string;
      readonly object: ObjectId;
      readonly field: DescendantId;
      readonly target: NodeTarget | null;
    }
  | { readonly kind: 'path'; readonly key: string; readonly path: string };

/** A definition's uses; a Model failure counts as none. */
export interface UsageView {
  readonly count: number;
  readonly items: readonly UsageItem[];
}

/** One definition card: the definition as drafted, its draft, and what Model says about it. */
export interface DefinitionEntry {
  readonly definition: Definition;
  readonly draft: DefinitionDraft | null;
  readonly literalDrafts: readonly LiteralDraft[];
  readonly pending: boolean;
  readonly canonical: string;
  readonly usages: UsageView;
}

/** The panel for the open collection; `blocked` means busy or disconnected. */
export interface DefinitionsPanel {
  readonly selection: DefinitionSelection;
  readonly savedCount: number;
  readonly busy: boolean;
  readonly blocked: boolean;
  readonly entries: readonly DefinitionEntry[];
}

/** A literal control's outcome: a parsed literal, or unparsed number text kept as a draft. */
export type LiteralCommit =
  | {
      readonly kind: 'value';
      readonly expression: LiteralExpression;
      readonly path: ExpressionPath;
    }
  | { readonly kind: 'draft'; readonly draft: LiteralDraft };

/** Draft keys currently being transmitted; controls remain frozen until their receipt settles. */
export interface DefinitionState {
  readonly drafts: readonly DefinitionDraft[];
  readonly pending: readonly DefinitionDraftKey[];
  readonly problem: Diagnostic | null;
}

export interface DefinitionSession {
  getSnapshot(): DefinitionState;
  subscribe(listener: () => void): () => void;
  restore(workspace: WorkspaceId): Result<void>;
  create(
    selection: DefinitionSelection,
    definition: Definition,
  ): Result<void>;
  edit(
    selection: DefinitionSelection,
    definition: Definition,
    literalDraft: LiteralDraft | null,
    editedPath: ExpressionPath | null,
  ): Result<void>;
  remove(
    selection: DefinitionSelection,
    definition: Definition,
  ): Result<void>;
  discard(key: DefinitionDraftKey): Result<void>;
  apply(key: DefinitionDraftKey): Promise<Result<void>>;
  /** A matching Authoring receipt may settle a retained request after reload/reconciliation. */
  bindRequest(
    key: DefinitionDraftKey,
    request: Request,
  ): Result<void>;
  confirmed(requestId: RequestId): void;
  released(requestId: RequestId): void;
  /** Clears only a temporary Apply lock when no request was retained. */
  unlockWithoutRequest(key: DefinitionDraftKey): void;
}

export type DefinitionFactory = (
  callbacks: Pick<DefinitionBindings, 'apply' | 'report'>,
) => DefinitionSession;

export interface DefinitionBindings {
  readonly retention: Pick<DraftRetention, 'read' | 'write'>;
  read(input: unknown): Result<readonly DefinitionDraft[]>;
  apply(draft: DefinitionDraft): Promise<Result<Receipt>>;
  report(error: Diagnostic): void;
}
