/*
 * The Apply lock on definition drafts. A key is locked while its Apply is pending or while its
 * draft holds a submitted request. A receipt removes the draft; a refusal keeps it and clears the
 * request. Each function returns the next state or drafts; the session writes and publishes them.
 */
import type { RequestId, WorkspaceId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { DefinitionDraft, DefinitionState } from '../../contract/records/definitions.js';
import type { Request } from '../../contract/records/owners.js';

/** How a submitted request ended: confirmed removes its draft; released makes it editable again. */
export type RequestOutcome = 'confirmed' | 'released';

/** The key whose request settled, and the drafts that are left. */
export interface SettledRequest {
  readonly key: string;
  readonly drafts: readonly DefinitionDraft[];
}

/** Restored state: drafts holding a request lock again; another workspace's drafts fail. */
export function restoredState(
  drafts: readonly DefinitionDraft[],
  workspace: WorkspaceId,
): Result<DefinitionState> {
  if (drafts.some((draft) => draft.base.workspace !== workspace))
    return failure('wrong-workspace', 'Stored definitions belong to another workspace');
  return { ok: true, value: { drafts, pending: requestKeys(drafts), problem: null } };
}

/** The state once Apply starts: the key is locked and the problem cleared. */
export function applyingState(
  state: DefinitionState,
  key: string,
  draft: DefinitionDraft,
): Result<DefinitionState> {
  const guard = applyGuard(state.pending, key, draft);
  if (!guard.ok) return guard;
  return { ok: true, value: { ...state, pending: [...state.pending, key], problem: null } };
}

/** Drafts after a discard. A pending Apply, or any draft of the key with a request, blocks it. */
export function discardedDrafts(
  state: DefinitionState,
  key: string,
): Result<readonly DefinitionDraft[]> {
  const bound = state.drafts.find((draft) => draft.key === key && draft.request !== undefined);
  const lock = submissionLock(state.pending, key, bound);
  if (!lock.ok) return lock;
  return { ok: true, value: withoutDraft(state.drafts, key) };
}

/** The drafts with the request saved on the key's draft; null when no draft has the key. */
export function boundDrafts(
  drafts: readonly DefinitionDraft[],
  key: string,
  request: Request,
): readonly DefinitionDraft[] | null {
  if (!drafts.some((draft) => draft.key === key)) return null;
  return withRequest(drafts, key, request);
}

/** The draft holding a settled request, and the drafts it leaves; null when no draft holds it. */
export function settledRequest(
  drafts: readonly DefinitionDraft[],
  requestId: RequestId,
  outcome: RequestOutcome,
): SettledRequest | null {
  const draft = drafts.find((item) => item.request?.request === requestId);
  if (draft === undefined) return null;
  return { key: draft.key, drafts: settledDrafts(drafts, draft.key, outcome) };
}

/** The state with the key's Apply lock removed. */
export function unlocked(
  state: DefinitionState,
  key: string,
): DefinitionState {
  return { ...state, pending: state.pending.filter((item) => item !== key) };
}

/** The key unlocked when its draft holds no request; null keeps the lock on a submitted request. */
export function unlockedWithoutRequest(
  state: DefinitionState,
  key: string,
): DefinitionState | null {
  const draft = state.drafts.find((item) => item.key === key);
  if (draft?.request !== undefined) return null;
  return unlocked(state, key);
}

/** A pending Apply or a saved request locks the draft. Edit and discard share this one message. */
export function submissionLock(
  pending: readonly string[],
  key: string,
  draft: DefinitionDraft | undefined,
): Result<void> {
  if (pending.includes(key) || draft?.request !== undefined)
    return failure('pending-request', 'This definition is being submitted; wait for confirmation');
  return { ok: true, value: undefined };
}

/** The drafts without the key's draft. */
export function withoutDraft(
  drafts: readonly DefinitionDraft[],
  key: string,
): readonly DefinitionDraft[] {
  return drafts.filter((draft) => draft.key !== key);
}

/** Apply needs the key unlocked and every literal finished; the pending check comes first. */
function applyGuard(
  pending: readonly string[],
  key: string,
  draft: DefinitionDraft,
): Result<void> {
  if (pending.includes(key))
    return failure('pending-request', 'This definition is already being submitted');
  if (hasLiteralDrafts(draft))
    return failure(
      'invalid-literal-draft',
      'Finish the literal value before applying this definition',
    );
  return { ok: true, value: undefined };
}

/** Whether the draft still holds number text that is not yet a number. */
function hasLiteralDrafts(draft: DefinitionDraft): boolean {
  return (draft.literalDrafts ?? []).length > 0;
}

/** The keys of drafts that hold a request. */
function requestKeys(drafts: readonly DefinitionDraft[]): readonly string[] {
  return drafts.filter((draft) => draft.request !== undefined).map((draft) => draft.key);
}

/** The drafts after a settled request. A new outcome is a compile error until it has a case. */
function settledDrafts(
  drafts: readonly DefinitionDraft[],
  key: string,
  outcome: RequestOutcome,
): readonly DefinitionDraft[] {
  switch (outcome) {
    case 'confirmed':
      return withoutDraft(drafts, key);
    case 'released':
      return withRequest(drafts, key, undefined);
  }
}

/** The drafts with the key's request set; undefined keeps `request` as a present key. */
function withRequest(
  drafts: readonly DefinitionDraft[],
  key: string,
  request: Request | undefined,
): readonly DefinitionDraft[] {
  return drafts.map((draft) => requestOn(draft, key, request));
}

/** One draft with its request set when it has the key; other drafts are returned as they are. */
function requestOn(
  draft: DefinitionDraft,
  key: string,
  request: Request | undefined,
): DefinitionDraft {
  if (draft.key !== key) return draft;
  return { ...draft, request };
}
