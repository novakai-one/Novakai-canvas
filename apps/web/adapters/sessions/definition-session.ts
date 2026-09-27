/*
 * The definition draft session: the drafts, the keys whose Apply is pending, and the last problem.
 * Core decides each change (core/definitions, through the contract). This file keeps the state,
 * calls storage and the Apply binding, and publishes in a fixed order.
 *
 * create takes the new definition's ID from the ID source. Per key: an edit saves a draft; Apply
 * locks the key; the workspace session saves the request on the draft (bindRequest); a receipt
 * removes the draft (confirmed); a refusal clears the request (released). Recovery: Authoring owns
 * the request journal. After a reload, restore locks every draft that holds a request until the
 * workspace session settles that request: confirmed on its receipt, released on a refusal. Methods
 * that return nothing report failures through bindings.report and state.problem.
 *
 * restore forgets the workspace before it reads. After a failed restore the old drafts stay and
 * edits are refused. With no workspace there is no storage key, so discard, Apply and
 * settleRequest change the drafts in memory only.
 *
 * Kept as HEAD behaves (tracker quirks):
 * - #10 An Apply result that arrives after a workspace switch acts on the new workspace's drafts.
 * - #11 settleRequest ignores a failed write: the draft keeps its request but its key unlocks.
 * - #12 A successful Apply writes twice: confirmed removes the draft, then settle writes again.
 * - #13 A failed Apply can be reported twice: by the workspace session, then by settle.
 * - #17 The subscribe cleanup returns Set.delete's boolean.
 */
import type { Result, Diagnostic } from '../../contract/errors.js';
import type { WorkspaceId } from '../../contract/brands.js';
import type { Request } from '../../contract/records/owners.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';
import type {
  DefinitionBindings,
  DefinitionDraft,
  DefinitionSelection,
  DefinitionSession,
  DefinitionState,
} from '../../contract/records/definitions.js';
import {
  applyingState,
  boundDrafts,
  discardedDrafts,
  editedDrafts,
  encodeDefinitionDrafts,
  newDefinition,
  restoredState,
  settledRequest,
  unlocked,
  unlockedWithoutRequest,
  withoutDraft,
  restoredWorkspace,
  unrestoredWorkspace,
  type DefinitionEdit,
  type RequestOutcome,
} from '../../contract/api.js';

/** The definition session over injected storage, reader, Apply and report bindings. */
export function createDefinitionSession(bindings: DefinitionBindings): DefinitionSession {
  let state: DefinitionState = { drafts: [], pending: [], problem: null };
  let scope: WorkspaceScope = unrestoredWorkspace;
  const listeners = new Set<() => void>();
  /** Each change replaces the immutable snapshot, then calls every listener. */
  function publish(next: DefinitionState): void {
    state = next;
    listeners.forEach((listener) => listener());
  }
  /** A failure becomes the problem, is reported, and is returned. */
  function reject(error: Diagnostic): Result<void> {
    publish({ ...state, problem: error });
    bindings.report(error);
    return { ok: false, error };
  }
  /**
   * Stores the drafts, then publishes them with the pending keys; returns storage's own result.
   * With no workspace it only publishes (see the file header).
   */
  function write(drafts: readonly DefinitionDraft[]): Result<void> {
    if (scope.phase === 'unrestored') return published(drafts);
    const result = bindings.retention.write(
      retentionKey(scope.workspace),
      encodeDefinitionDrafts(drafts),
    );
    if (!result.ok) return reject(result.error);
    return published(drafts);
  }
  /** Publishes the drafts with the pending keys and no problem. */
  function published(drafts: readonly DefinitionDraft[]): Result<void> {
    publish({ drafts, pending: state.pending, problem: null });
    return { ok: true, value: undefined };
  }
  /** Reads a workspace's stored drafts. The workspace is forgotten first (see the file header). */
  function restore(id: WorkspaceId): Result<void> {
    scope = unrestoredWorkspace;
    const stored = bindings.retention.read(retentionKey(id));
    if (!stored.ok) return reject(stored.error);
    if (stored.value === null) return install(id, []);
    return restoreStored(id, stored.value);
  }
  /** Stored drafts come back through the reader binding. */
  function restoreStored(
    id: WorkspaceId,
    value: unknown,
  ): Result<void> {
    const drafts = bindings.read(value);
    if (!drafts.ok) return reject(drafts.error);
    return install(id, drafts.value);
  }
  /** Adopts the workspace and its drafts; another workspace's drafts are refused. */
  function install(
    id: WorkspaceId,
    drafts: readonly DefinitionDraft[],
  ): Result<void> {
    const restored = restoredState(drafts, id);
    if (!restored.ok) return reject(restored.error);
    scope = restoredWorkspace(id);
    publish(restored.value);
    return { ok: true, value: undefined };
  }
  /**
   * Drafts a new definition with an ID from the ID source. Fails with `id-unavailable` (reported,
   * drafts unchanged) or as {@link retain} does.
   */
  function create(selection: DefinitionSelection): Result<void> {
    const id = bindings.ids.definitionId();
    if (!id.ok) return reject(id.error);
    return retain({ operation: 'create', selection, definition: newDefinition(id.value) });
  }
  /** Create, edit and remove keep one draft per definition; a refused edit becomes the problem. */
  function retain(edit: DefinitionEdit): Result<void> {
    const drafts = editedDrafts(state, scope, edit);
    if (!drafts.ok) return reject(drafts.error);
    return write(drafts.value);
  }
  /** Removes the key's draft; a draft being submitted cannot be discarded. */
  function discard(key: string): Result<void> {
    const drafts = discardedDrafts(state, key);
    if (!drafts.ok) return reject(drafts.error);
    return write(drafts.value);
  }
  /** Locks the key and submits its draft. A missing draft makes no request. */
  async function apply(key: string): Promise<Result<void>> {
    const draft = state.drafts.find((item) => item.key === key);
    if (draft === undefined) return { ok: true, value: undefined };
    const applying = applyingState(state, key, draft);
    if (!applying.ok) return reject(applying.error);
    publish(applying.value);
    return settle(key, draft);
  }
  /** Success removes the draft; failure unlocks the key unless its draft holds a request. */
  async function settle(
    key: string,
    draft: DefinitionDraft,
  ): Promise<Result<void>> {
    const result = await bindings.apply(draft);
    if (!result.ok) {
      unlockWithoutRequest(key);
      return reject(result.error);
    }
    return write(withoutDraft(state.drafts, key));
  }
  /** Saves the request on the key's draft so a reload can settle it; no draft saves nothing. */
  function bindRequest(
    key: string,
    request: Request,
  ): Result<void> {
    const drafts = boundDrafts(state.drafts, key, request);
    if (drafts === null) return { ok: true, value: undefined };
    return write(drafts);
  }
  /** A receipt or refusal settles the draft holding its request; the key unlocks after it. */
  function settleRequest(
    requestId: string,
    outcome: RequestOutcome,
  ): void {
    const settled = settledRequest(state.drafts, requestId, outcome);
    if (settled === null) return;
    void write(settled.drafts);
    publish(unlocked(state, settled.key));
  }
  /** Ends the key's Apply lock unless its draft holds a request. */
  function unlockWithoutRequest(key: string): void {
    const next = unlockedWithoutRequest(state, key);
    if (next !== null) publish(next);
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore,
    create,
    edit: (selection, definition, literalDraft, editedPath) =>
      retain({ operation: 'replace', selection, definition, literalDraft, editedPath }),
    remove: (selection, definition) => retain({ operation: 'remove', selection, definition }),
    discard,
    apply,
    bindRequest,
    confirmed: (requestId) => settleRequest(requestId, 'confirmed'),
    released: (requestId) => settleRequest(requestId, 'released'),
    unlockWithoutRequest,
  };
}

/** The storage key of a workspace's definition drafts. */
function retentionKey(workspace: WorkspaceId): string {
  return `definitions.${workspace}`;
}
