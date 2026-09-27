/*
 * Create, edit and remove on definition drafts. Each definition keeps one draft, keyed by its
 * collection and definition IDs. The first edit captures the collection base, generation and
 * collection; later edits keep them. Number text that is not yet a number stays a literal draft
 * while its path is still a literal that the edit did not touch.
 */
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';
import type {
  Definition,
  DefinitionDraft,
  DefinitionSelection,
  DefinitionState,
  ExpressionPath,
  LiteralDraft,
  TypeExpression,
} from '../../contract/records/definitions.js';
import { captureCollectionBase } from '../recovery/editor-records.js';
import { inWorkspace } from '../workspace/workspace-scope.js';
import { submissionLock, withoutDraft } from './draft-lifecycle.js';
import { isPathWithin, samePath } from './paths.js';

/** One edit to a definition. Only a replacement carries a literal draft and the path it edited. */
export type DefinitionEdit =
  | {
      readonly operation: 'create' | 'remove';
      readonly selection: DefinitionSelection;
      readonly definition: Definition;
    }
  | {
      readonly operation: 'replace';
      readonly selection: DefinitionSelection;
      readonly definition: Definition;
      readonly literalDraft: LiteralDraft | null;
      readonly editedPath: ExpressionPath | null;
    };

/**
 * The drafts after an edit. The workspace is checked first: an edit outside the restored workspace,
 * or before one is restored, is `wrong-workspace`. Then the Apply lock.
 */
export function editedDrafts(
  state: DefinitionState,
  scope: WorkspaceScope,
  edit: DefinitionEdit,
): Result<readonly DefinitionDraft[]> {
  if (!inWorkspace(scope, edit.selection.base.workspace))
    return failure('wrong-workspace', 'Recover the original workspace before editing');
  return unlockedEdit(state, edit);
}

/** What a replacement typed; create and remove type nothing. */
type LiteralTyping = Pick<
  Extract<DefinitionEdit, { readonly operation: 'replace' }>,
  'literalDraft' | 'editedPath'
>;

/** The typing of an edit that carries none. */
const untyped: LiteralTyping = { literalDraft: null, editedPath: null };

/** The edit merged into the drafts, unless the key's first draft is locked. */
function unlockedEdit(
  state: DefinitionState,
  edit: DefinitionEdit,
): Result<readonly DefinitionDraft[]> {
  const key = draftKey(edit);
  const current = state.drafts.find((draft) => draft.key === key);
  const lock = submissionLock(state.pending, key, current);
  if (!lock.ok) return lock;
  return mergedDrafts(state.drafts, key, current, edit);
}

/** Removing an unsaved create drops its draft before any base capture; other edits replace it. */
function mergedDrafts(
  drafts: readonly DefinitionDraft[],
  key: string,
  current: DefinitionDraft | undefined,
  edit: DefinitionEdit,
): Result<readonly DefinitionDraft[]> {
  if (removesUnsavedCreate(current, edit)) return { ok: true, value: withoutDraft(drafts, key) };
  const draft = editedDraft(key, current, edit);
  if (!draft.ok) return draft;
  return { ok: true, value: [...withoutDraft(drafts, key), draft.value] };
}

/** The key's draft after the edit. The current draft's base, generation and collection win. */
function editedDraft(
  key: string,
  current: DefinitionDraft | undefined,
  edit: DefinitionEdit,
): Result<DefinitionDraft> {
  const base = captureCollectionBase(
    current?.base ?? edit.selection.base,
    edit.selection.collection.id,
  );
  if (!base.ok) return base;
  return {
    ok: true,
    value: {
      key,
      base: base.value,
      generation: current?.generation ?? edit.selection.generation,
      collection: current?.collection ?? edit.selection.collection,
      definition: edit.definition,
      operation: nextOperation(current?.operation, edit.operation),
      request: current?.request,
      literalDrafts: nextLiteralDrafts(current?.literalDrafts, edit),
    },
  };
}

/** The draft key: collection ID, then definition ID. */
function draftKey(edit: DefinitionEdit): string {
  return `${edit.selection.collection.id}:${edit.definition.id}`;
}

/** Whether the edit removes a definition that was created but never applied. */
function removesUnsavedCreate(
  current: DefinitionDraft | undefined,
  edit: DefinitionEdit,
): boolean {
  return current?.operation === 'create' && edit.operation === 'remove';
}

/** Remove always wins; editing a removed definition replaces it; otherwise the first one stays. */
function nextOperation(
  current: DefinitionDraft['operation'] | undefined,
  requested: DefinitionDraft['operation'],
): DefinitionDraft['operation'] {
  if (requested === 'remove') return 'remove';
  if (current === 'remove') return 'replace';
  return current ?? requested;
}

/** The literal drafts kept by the edit, plus the one it typed; none gives undefined. */
function nextLiteralDrafts(
  current: readonly LiteralDraft[] | undefined,
  edit: DefinitionEdit,
): readonly LiteralDraft[] | undefined {
  const typing = literalTyping(edit);
  const retained = (current ?? []).filter((draft) =>
    keepsLiteralDraft(edit.definition, draft, typing.editedPath),
  );
  return withLiteralDraft(retained, typing.literalDraft);
}

/** The literal draft and edited path a replacement carries. */
function literalTyping(edit: DefinitionEdit): LiteralTyping {
  if (edit.operation !== 'replace') return untyped;
  return edit;
}

/** A literal draft stays while its path is still a literal outside the edited path. */
function keepsLiteralDraft(
  definition: Definition,
  draft: LiteralDraft,
  editedPath: ExpressionPath | null,
): boolean {
  if (expressionAt(definition.expression, draft.path)?.kind !== 'literal') return false;
  return editedPath === null || !isPathWithin(draft.path, editedPath);
}

/** The typed draft replaces any draft at its path and goes last; no drafts gives undefined. */
function withLiteralDraft(
  retained: readonly LiteralDraft[],
  literalDraft: LiteralDraft | null,
): readonly LiteralDraft[] | undefined {
  if (literalDraft !== null)
    return [...retained.filter((draft) => !samePath(draft.path, literalDraft.path)), literalDraft];
  if (retained.length === 0) return undefined;
  return retained;
}

/** The expression at a path; undefined when the path leaves the unions. */
function expressionAt(
  expression: TypeExpression,
  path: ExpressionPath,
): TypeExpression | undefined {
  return path.reduce<TypeExpression | undefined>(unionItem, expression);
}

/** One step down a path: the union item at the index. */
function unionItem(
  expression: TypeExpression | undefined,
  index: number,
): TypeExpression | undefined {
  if (expression?.kind !== 'union') return undefined;
  return expression.items[index];
}
