import type {
  RetainedDraft,
  RetainedEditor,
  RetainedEditorBindings,
  RetainedEditorState,
} from '../../contract/records/retained-editor.js';
import type { WorkspaceId } from '../../contract/brands.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';
import type { Result, Diagnostic } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { inWorkspace, restoredWorkspace, unrestoredWorkspace } from '../../contract/api.js';
/** Browser forms share persistence and acknowledgement policy; feature bindings own command replay and admission. */
export function createRetainedEditor<Selection, Command, Draft extends RetainedDraft>(
  bindings: RetainedEditorBindings<Selection, Command, Draft>,
): RetainedEditor<Selection, Command, Draft> {
  let state: RetainedEditorState<Draft> = { drafts: [], problem: null };
  let scope: WorkspaceScope = unrestoredWorkspace;
  const listeners = new Set<() => void>();
  /** Cached immutable snapshots satisfy React external-store identity requirements. */
  function publish(next: RetainedEditorState<Draft>): void {
    state = next;
    listeners.forEach((listener) => listener());
  }
  /** Rejections are both typed command outcomes and readable retained-form state. */
  function reject(error: Diagnostic): Result<void> {
    publish({ ...state, problem: error });
    bindings.report(error);
    return { ok: false, error };
  }
  /** Failed local retention remains visible; the in-memory form is never silently discarded. */
  function save(drafts: readonly Draft[]): Result<void> {
    if (scope.phase === 'unrestored')
      return reject(
        failure('unavailable', 'Recover this workspace before changing retained forms').error,
      );
    publish({ ...state, drafts });
    const result = writeDrafts(drafts, scope.workspace);
    if (!result.ok) return reject(result.error);
    publish({ drafts, problem: null });
    return result;
  }
  function writeDrafts(
    drafts: readonly Draft[],
    workspace: WorkspaceId,
  ): Result<void> {
    const encoded = bindings.encode(drafts);
    if (!encoded.ok) return encoded;
    return bindings.retention.write(`${bindings.namespace}.${workspace}`, encoded.value);
  }
  /** Read failure blocks all writes while preserving previous forms and both workspaces' stored data. */
  function restore(id: WorkspaceId): Result<void> {
    scope = unrestoredWorkspace;
    const stored = bindings.retention.read(`${bindings.namespace}.${id}`);
    if (!stored.ok) return reject(stored.error);
    return restoreValue(stored.value, id);
  }
  /** Recovery never replays a command. The storage key changes only after the destination was read and admitted. */
  function restoreValue(
    value: unknown,
    id: WorkspaceId,
  ): Result<void> {
    if (value === null) return restored([], id);
    const checked = bindings.read(value);
    if (!checked.ok) return reject(checked.error);
    return restored(checked.value, id);
  }
  /** Foreign-workspace payloads cannot become forms under a newly admitted storage key. */
  function restored(
    drafts: readonly Draft[],
    id: WorkspaceId,
  ): Result<void> {
    if (drafts.some((draft) => draft.base.workspace !== id))
      return reject(
        failure(
          'wrong-workspace',
          'Stored forms belong to a different workspace; data was retained',
        ).error,
      );
    scope = restoredWorkspace(id);
    publish({ drafts, problem: null });
    return { ok: true, value: undefined };
  }
  /** The feature captures the first version and replays later edits against it. */
  function edit(
    selection: Selection,
    command: Command,
  ): Result<void> {
    const next = bindings.edit(selection, command, state.drafts);
    if (!inWorkspace(scope, next.base.workspace))
      return reject(
        failure('wrong-workspace', 'Recover the original workspace before editing this form').error,
      );
    return save([...state.drafts.filter((draft) => draft.key !== next.key), next]);
  }
  /** Explicit discard or exact-generation acknowledgement removes one form. */
  function discard(key: string): Result<void> {
    return save(state.drafts.filter((draft) => draft.key !== key));
  }
  /** Missing or already discarded forms make no request; cross-workspace forms fail explicitly. */
  async function apply(key: string): Promise<Result<void>> {
    const draft = state.drafts.find((item) => item.key === key);
    if (draft === undefined) return { ok: true, value: undefined };
    return submitDraft(draft);
  }
  /** No failed restore or later workspace switch may submit a form under another workspace's authority. */
  async function submitDraft(draft: Draft): Promise<Result<void>> {
    if (!inWorkspace(scope, draft.base.workspace))
      return reject(
        failure('unavailable', 'Recover this workspace before applying its forms').error,
      );
    const result = await bindings.apply(draft);
    return finishSubmission(draft, result);
  }
  /** Late outcomes retain their original workspace identity; the new workspace cannot acknowledge them. */
  function finishSubmission(
    draft: Draft,
    result: Result<unknown>,
  ): Result<void> {
    if (!inWorkspace(scope, draft.base.workspace))
      return failure(
        'wrong-workspace',
        'The original workspace owns this submission; reconcile its receipt there',
      );
    if (!result.ok) return reject(result.error);
    return acknowledge(draft);
  }
  /** Object identity distinguishes the submitted immutable draft from later edits. */
  function acknowledge(draft: Draft): Result<void> {
    const latest = state.drafts.find((item) => item.key === draft.key);
    if (latest === draft) return discard(draft.key);
    return { ok: true, value: undefined };
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore,
    edit,
    discard,
    apply,
  };
}
