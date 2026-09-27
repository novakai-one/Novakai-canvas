import type { WorkspaceId } from '../brands.js';
import type { DraftRetention } from '../ports/draft-retention.js';
import type { Result, Diagnostic } from '../errors.js';
/** Minimal browser draft identity; domain records and commands stay with the feature. */
export interface RetainedDraft {
  readonly key: string;
  readonly base: { readonly workspace: WorkspaceId };
}
export interface RetainedEditorState<Draft> {
  readonly drafts: readonly Draft[];
  readonly problem: Diagnostic | null;
}
/** The shared lifecycle persists, restores and acknowledges forms without understanding their content. */
export interface RetainedEditor<Selection, Command, Draft> {
  getSnapshot(): RetainedEditorState<Draft>;
  subscribe(listener: () => void): () => void;
  restore(workspace: WorkspaceId): Result<void>;
  edit(
    selection: Selection,
    command: Command,
  ): Result<void>;
  discard(key: string): Result<void>;
  apply(key: string): Promise<Result<void>>;
}
export interface RetainedEditorBindings<Selection, Command, Draft extends RetainedDraft> {
  readonly namespace: string;
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
