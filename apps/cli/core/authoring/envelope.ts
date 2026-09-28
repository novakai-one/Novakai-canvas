/*
 * The one Authoring request envelope the CLI sends: actor `agent:cli`, envelope version 1, the
 * preconditions, a write scope of exactly their keys, the bound assets and the change intent,
 * checked by Authoring's request schema. Pure. A rejected envelope is the failure the caller
 * names, and nothing is sent.
 */
import type { RequestIds } from '../../contract/ports/request-ids.js';
import type { Retains } from '../../contract/records/command.js';
import type { ReadVersion, Request } from '../../contract/records/foreign.js';
import type { AssetBinding } from '../../contract/records/staged-resource.js';
import type { RequestId, WorkspaceId } from '../../contract/brands.js';
import { success, type FailureInput, type Result } from '../../contract/errors.js';
import { requestSchema } from '../../contract/schemas.js';
import { checked } from '../shared/checks.js';

/** The Authoring planner that turns the payload into writes: DSL source, or a prepared preset. */
export type Planner = 'dsl' | 'preset';

/** What differs between two CLI requests. */
export interface EnvelopeDraft {
  readonly workspace: WorkspaceId;
  readonly request: RequestId;
  /** Each record the request expects at a version, or absent; also the write scope. */
  readonly expected: readonly ReadVersion[];
  readonly assets: readonly AssetBinding[];
  readonly planner: Planner;
  /** Sent unchanged as the change intent's payload. */
  readonly payload: unknown;
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
    intent: { kind: 'change', planner: draft.planner, payload: draft.payload },
  };
  return checked<Request>(requestSchema, request, rejectedAs);
}

/**
 * The command's `--request` when given, so a script can look up its receipt; else a fresh ID.
 * Fails as the fresh ID's source does.
 */
export function requestIdFor(
  command: Retains,
  ids: RequestIds,
): Result<RequestId> {
  if (command.request !== undefined) return success(command.request);
  return ids.next();
}
