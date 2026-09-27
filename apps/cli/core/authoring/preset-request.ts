/*
 * The Authoring request of one prepared preset (`theme admit`, `recipe admit`). It expects the
 * workspace metadata record at its observed version, so admissions are serialised, and the preset
 * record at its stored version or absent. Pure. Nothing is sent; the service still recomputes the
 * preset and compares every read when it admits it.
 */
import type {
  ReadVersion,
  Request,
  Snapshot,
  StoredRecord,
} from '../../contract/records/foreign.js';
import type { PresetPreparation } from '../../contract/records/service-answers.js';
import type { AssetBinding } from '../../contract/records/staged-resource.js';
import type { RecordId, RequestId } from '../../contract/brands.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { envelope } from './envelope.js';

/** One prepared preset, before its preconditions are read from the snapshot. */
export interface PresetDraft {
  readonly preparation: PresetPreparation;
  /** The staged fonts and images, bound under the aliases the preset file declares. */
  readonly assets: readonly AssetBinding[];
  readonly request: RequestId;
}

/** A preparation Authoring's request schema rejects: the service's answer, not the user's input. */
const unpreparedPreset: FailureInput = Object.freeze({
  code: 'invalid-response',
  message: 'Prepared preset cannot form an Authoring request',
});

/**
 * The preset's Authoring request; its payload is the service's preparation, unchanged. Fails with
 * `invalid-response`: the snapshot has no workspace metadata record, or the request fails
 * Authoring's schema.
 */
export function presetRequest(
  draft: PresetDraft,
  snapshot: Snapshot,
): Result<Request> {
  const metadata = snapshot.records.find(isMetadata);
  if (metadata === undefined)
    return failure({ code: 'invalid-response', message: 'Workspace metadata is missing' });
  const expected: readonly ReadVersion[] = [
    { key: metadata.key, version: metadata.version },
    { key: draft.preparation.key, version: presetVersion(snapshot, draft.preparation.key.id) },
  ];
  return envelope(
    {
      workspace: snapshot.workspace,
      request: draft.request,
      expected,
      assets: draft.assets,
      planner: 'preset',
      payload: draft.preparation.document,
    },
    unpreparedPreset,
  );
}

/** Whether the record is the workspace metadata record. */
function isMetadata(record: StoredRecord): boolean {
  return record.key.kind === 'workspace' && record.key.id === 'metadata';
}

/** The stored version of the preset record `id`, or `absent` when none is stored. */
function presetVersion(
  snapshot: Snapshot,
  id: RecordId,
): ReadVersion['version'] {
  const stored = snapshot.records.find((item) => item.key.kind === 'preset' && item.key.id === id);
  if (stored === undefined) return 'absent';
  return stored.version;
}
