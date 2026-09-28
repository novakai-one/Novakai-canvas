/*
 * Why this file exists
 *
 * Every request the CLI sends to Authoring has the same parts, whether `create` sends source text
 * or `theme admit` sends a prepared theme.
 * - Added here, the same on every request: the sender (`agent:cli`) and the format's version.
 * - Given by the caller: workspace, request ID, records it expects, fonts and images, the change.
 *
 * This file puts them together and runs Authoring's own check, so a bad request is caught before
 * it leaves. It never sends anything.
 */
import type { ChangeMode } from '../../contract/records/command.js';
import type { ReadVersion, AuthoringRequest } from '../../contract/records/foreign.js';
import type { PresetDocument } from '../../contract/records/service-answers.js';
import type { NamedAssetDigest } from '../../contract/records/staged-resource.js';
import type { RequestId, WorkspaceId } from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { requestSchema } from '../../contract/schemas.js';

/** What a source change sends: its text, unchanged, and whether it creates, replaces or patches. */
export interface SourceChange {
  readonly source: string;
  readonly mode: ChangeMode;
}

/**
 * What the request asks Authoring to do. A planner is the part of Authoring that turns the payload
 * into saved records: `dsl` reads source text, and `preset` reads a prepared theme or recipe.
 */
export type PlannedChange =
  | { readonly planner: 'dsl'; readonly payload: SourceChange }
  | { readonly planner: 'preset'; readonly payload: PresetDocument };

/** The parts of an Authoring request the caller gives. The sender and version are added here. */
export interface AuthoringRequestDraft {
  readonly workspace: WorkspaceId;
  readonly request: RequestId;
  /** Each record the request expects, at a version or `absent`. It may write only these. */
  readonly expected: readonly ReadVersion[];
  /** The fonts and images the change uses: each one's name and the digest of its bytes. */
  readonly assets: readonly NamedAssetDigest[];
  readonly change: PlannedChange;
}

/** Who every CLI request is sent as. */
const actor = Object.freeze({ id: 'agent:cli', kind: 'agent' });

/**
 * Builds the whole Authoring request from `draft`, and checks it with Authoring's own check.
 * If the check refuses it, gives back `mistake`, the failure the caller chose.
 */
export function buildAuthoringRequest(
  draft: AuthoringRequestDraft,
  mistake: Result<never, LocalFailure>,
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
  if (!checkedRequest.success) return mistake;
  return success(checkedRequest.data);
}
