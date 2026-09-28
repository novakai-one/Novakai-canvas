/*
 * Why this file exists
 *
 * Saving a theme or recipe for reuse (`theme admit`, `recipe admit`) is a change like any other,
 * so it goes to Authoring as a request. Templates calls a saved theme or recipe a preset. Two
 * saves must not overwrite each other, so each request expects the workspace's metadata record at
 * the version just read: if another save got there first, Authoring refuses this one.
 *
 * This file builds that request around the service's prepared preset, passed on unchanged. It
 * never sends anything; the service checks the preset again when it saves it.
 */
import type {
  ReadVersion,
  AuthoringRequest,
  WorkspaceSnapshot,
  StoredRecord,
} from '../../contract/records/foreign.js';
import type { PresetPreparation } from '../../contract/records/service-answers.js';
import type { NamedAssetDigest } from '../../contract/records/staged-resource.js';
import type { RecordId, RequestId } from '../../contract/brands.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { buildAuthoringRequest } from './envelope.js';

/** One prepared theme or recipe, before it is checked against the workspace. */
export interface PresetDraft {
  /** The service's answer to preparing it: the key it will be saved under, and the whole answer. */
  readonly preparation: PresetPreparation;
  /** The staged fonts and images, bound under the aliases the preset file declares. */
  readonly assets: readonly NamedAssetDigest[];
  /** The ID the save is sent under. */
  readonly request: RequestId;
}

/** A preparation Authoring's request schema rejects: the service's answer, not the user's input. */
const unpreparedPreset: FailureInput = Object.freeze({
  code: 'invalid-response',
  message: 'Prepared preset cannot form an Authoring request',
});

/**
 * Builds the Authoring request that saves one prepared theme or recipe, checked against
 * `snapshot`, the workspace as read.
 * The mistakes it can find: the workspace has no metadata record, or the request fails
 * Authoring's check. Both are `invalid-response`: the service's answer was wrong, not the input.
 */
export function buildPresetRequest(
  draft: PresetDraft,
  snapshot: WorkspaceSnapshot,
): Result<AuthoringRequest> {
  const metadata = snapshot.records.find(isMetadata);
  if (metadata === undefined)
    return failure({ code: 'invalid-response', message: 'Workspace metadata is missing' });
  const expected: readonly ReadVersion[] = [
    { key: metadata.key, version: metadata.version },
    { key: draft.preparation.key, version: presetVersion(snapshot, draft.preparation.key.id) },
  ];
  return buildAuthoringRequest(
    {
      workspace: snapshot.workspace,
      request: draft.request,
      expected,
      assets: draft.assets,
      change: { planner: 'preset', payload: draft.preparation.document },
    },
    failure(unpreparedPreset),
  );
}

/** Whether the record is the workspace metadata record. */
function isMetadata(record: StoredRecord): boolean {
  return record.key.kind === 'workspace' && record.key.id === 'metadata';
}

/** The stored version of the preset record `id`, or `absent` when none is stored. */
function presetVersion(
  snapshot: WorkspaceSnapshot,
  id: RecordId,
): ReadVersion['version'] {
  const stored = snapshot.records.find((item) => item.key.kind === 'preset' && item.key.id === id);
  if (stored === undefined) return 'absent';
  return stored.version;
}
