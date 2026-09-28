/*
 * The one Authoring request envelope the CLI sends: actor `agent:cli`, envelope version 1, the
 * preconditions, a write scope of exactly their keys, the bound assets and the change intent,
 * checked by Authoring's request schema. Pure. A rejected envelope is the failure the caller
 * names, and nothing is sent.
 */
import type { ChangeMode } from '../../contract/records/command.js';
import type { ReadVersion, Request } from '../../contract/records/foreign.js';
import type { PresetDocument } from '../../contract/records/service-answers.js';
import type { AssetBinding } from '../../contract/records/staged-resource.js';
import type { RequestId, WorkspaceId } from '../../contract/brands.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { requestSchema } from '../../contract/schemas.js';
import { checked } from '../shared/checks.js';

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
  readonly assets: readonly AssetBinding[];
  readonly change: PlannedChange;
}

/** Who every CLI request is sent as. */
const actor = Object.freeze({ id: 'agent:cli', kind: 'agent' });

/**
 * The checked Authoring request of `draft`, scoped to exactly its preconditions' keys. Fails with
 * `rejectedAs` when Authoring's request schema rejects it.
 */
export function envelope(
  draft: EnvelopeDraft,
  rejectedAs: FailureInput,
): Result<Request> {
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
  return checked<Request>(requestSchema, request, rejectedAs);
}
