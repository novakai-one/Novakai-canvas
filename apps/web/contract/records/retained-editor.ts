/*
 * The retained-editor vocabulary shared by object forms and wire forms: the identity every form
 * has, the editor's methods and its bindings. Declarations only; the editor session keeps the
 * forms in its storage slot and owns their recovery.
 */
import type { ObjectDraftKey, RetentionSlot, WireDraftKey, WorkspaceId } from '../brands.js';
import type { DraftRetention } from '../ports/draft-retention.js';
import type { Result, Diagnostic } from '../errors.js';
/** The draft keys a retained editor holds: object forms or wire forms. */
export type RetainedDraftKey = ObjectDraftKey | WireDraftKey;
/** The storage slots of the retained editors: object forms and wire forms. */
export type RetainedEditorSlot = Extract<RetentionSlot, 'inspector' | 'wire-inspector'>;
/** Minimal browser draft identity; domain records and commands stay with the feature. */
export interface RetainedDraft {
  readonly key: RetainedDraftKey;
  readonly base: { readonly workspace: WorkspaceId };
}
/** The forms on screen and the last problem, if any. */
export interface RetainedEditorState<Draft> {
  readonly drafts: readonly Draft[];
  readonly problem: Diagnostic | null;
}
/** The shared lifecycle persists, restores and acknowledges forms without understanding their content. */
export interface RetainedEditor<Selection, Command, Draft extends RetainedDraft> {
  getSnapshot(): RetainedEditorState<Draft>;
  subscribe(listener: () => void): () => void;
  restore(workspace: WorkspaceId): Result<void>;
  edit(
    selection: Selection,
    command: Command,
  ): Result<void>;
  discard(key: Draft['key']): Result<void>;
  apply(key: Draft['key']): Promise<Result<void>>;
}
/** What one kind of form gives the shared editor: its slot, storage, codec, replay and Apply. */
export interface RetainedEditorBindings<Selection, Command, Draft extends RetainedDraft> {
  readonly slot: RetainedEditorSlot;
  readonly retention: Pick<DraftRetention, 'read' | 'write'>;
  readonly encode: (drafts: readonly Draft[]) => Result<unknown>;
  read(input: unknown): Result<readonly Draft[]>;
  edit(
    selection: Selection,
    command: Command,
    drafts: readonly Draft[],
  ): Draft;
  apply(draft: Draft): Promise<Result<unknown>>;
  report(error: Diagnostic): void;
}
