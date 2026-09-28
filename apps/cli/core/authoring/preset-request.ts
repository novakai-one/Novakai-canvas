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
import type { RecordId, RequestId, WorkspaceId } from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { buildAuthoringRequest } from './envelope.js';
import type { AuthoringRequestDraft, PlannedChange } from './envelope.js';

/** One prepared theme or recipe, before it is checked against the workspace. */
export interface PresetDraft {
  /**
   * The service's answer to preparing it: the key it will be saved under, and the prepared preset
   * itself (sent on unchanged).
   */
  readonly preparation: PresetPreparation;
  /** The staged fonts and images, bound under the aliases the preset file declares. */
  readonly assets: readonly NamedAssetDigest[];
  /** The ID the save is sent under. */
  readonly request: RequestId;
}

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
  if (metadata === undefined) {
    return missingMetadataFailure();
  }
  const expected = listPresetPreconditions(metadata, draft.preparation.key, snapshot);
  const requestDraft = draftPresetRequest(draft, snapshot.workspace, expected);
  return buildAuthoringRequest(requestDraft, unusablePresetFailure());
}

/** Whether the record is the workspace metadata record. */
function isMetadata(record: StoredRecord): boolean {
  return record.key.kind === 'workspace' && record.key.id === 'metadata';
}

/** Lists the records the save expects: the metadata record as read, then the preset's record. */
function listPresetPreconditions(
  metadata: StoredRecord,
  presetKey: PresetPreparation['key'],
  snapshot: WorkspaceSnapshot,
): readonly ReadVersion[] {
  const metadataVersion: ReadVersion = { key: metadata.key, version: metadata.version };
  const storedVersion = storedPresetVersion(snapshot, presetKey.id);
  const presetVersion: ReadVersion = { key: presetKey, version: storedVersion };
  return [metadataVersion, presetVersion];
}

/** Finds the stored version of the preset record `id`, or `absent` when none is stored. */
function storedPresetVersion(
  snapshot: WorkspaceSnapshot,
  id: RecordId,
): ReadVersion['version'] {
  const stored = snapshot.records.find((record) => isPresetRecord(record, id));
  if (stored === undefined) {
    return 'absent';
  }
  return stored.version;
}

/** Whether the record is the preset record `id`. */
function isPresetRecord(
  record: StoredRecord,
  id: RecordId,
): boolean {
  return record.key.kind === 'preset' && record.key.id === id;
}

/** Puts together the parts of the save request that `buildAuthoringRequest` is given. */
function draftPresetRequest(
  draft: PresetDraft,
  workspace: WorkspaceId,
  expected: readonly ReadVersion[],
): AuthoringRequestDraft {
  const change: PlannedChange = { planner: 'preset', payload: draft.preparation.document };
  return { workspace, request: draft.request, expected, assets: draft.assets, change };
}

/** Makes the mistake for a workspace with no metadata record (`invalid-response`). */
function missingMetadataFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-response', message: 'Workspace metadata is missing' });
}

/**
 * Makes the mistake for a prepared preset that Authoring's check refuses (`invalid-response`): the
 * service's answer was wrong, not the agent's input.
 */
function unusablePresetFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: 'Prepared preset cannot form an Authoring request',
  });
}
