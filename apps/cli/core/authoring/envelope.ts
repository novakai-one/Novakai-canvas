/*
 * The one Authoring request envelope the CLI sends: actor `agent:cli`, envelope version 1, the
 * preconditions, a write scope of exactly their keys, the bound assets and the change intent,
 * checked by Authoring's request schema. Pure. A rejected envelope is the failed step the caller
 * names, and nothing is sent.
 */
import type { ChangeMode } from '../../contract/records/command.js';
import type { ReadVersion, AuthoringRequest } from '../../contract/records/foreign.js';
import type { PresetDocument } from '../../contract/records/service-answers.js';
import type { NamedAssetDigest } from '../../contract/records/staged-resource.js';
import type { RequestId, WorkspaceId } from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { requestSchema } from '../../contract/schemas.js';

/** The DSL planner's payload: the source, sent unchanged, and how it changes the collection. */
export interface SourceChange {
  readonly source: string;
  readonly mode: ChangeMode;
}

/**
 * The Authoring planner that turns the payload into writes, and the payload it reads: DSL source,
 * or a prepared preset. The pair cannot mismatch. Sent unchanged as the change intent.
 */
export type PlannedChange =
  | { readonly planner: 'dsl'; readonly payload: SourceChange }
  | { readonly planner: 'preset'; readonly payload: PresetDocument };

/** What differs between two CLI requests. */
export interface EnvelopeDraft {
  readonly workspace: WorkspaceId;
  readonly request: RequestId;
  /** Each record the request expects at a version, or absent; also the write scope. */
  readonly expected: readonly ReadVersion[];
  readonly assets: readonly NamedAssetDigest[];
  readonly change: PlannedChange;
}

/** Who every CLI request is sent as. */
const actor = Object.freeze({ id: 'agent:cli', kind: 'agent' });

/**
 * The checked Authoring request of `draft`, scoped to exactly its preconditions' keys. Gives back
 * `rejected` when Authoring's request schema refuses it.
 */
export function envelope(
  draft: EnvelopeDraft,
  rejected: Result<never, LocalFailure>,
): Result<AuthoringRequest> {
  const request = {
    workspace: draft.workspace,
    request: draft.request,
    actor,
    version: 1,
    expected: draft.expected,
    scope: draft.expected.map((item) => item.key),
    assets: draft.assets,
    intent: { kind: 'change', ...draft.change },
  };
  const checkedRequest = requestSchema.safeParse(request);
  if (!checkedRequest.success) return rejected;
  return success(checkedRequest.data);
}
