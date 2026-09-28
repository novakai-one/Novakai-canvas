/*
 * Recovery records for retained editors: the captured collection base a draft is checked against,
 * and the stored source, object and wire drafts built on it. Pure. Every failure is
 * `invalid-recovery`; the editor that asked keeps its draft and reports the failure.
 */
import { diagnostic, type Result } from '../../contract/errors.js';
import type {
  CapturedCollectionBase,
  EditingBase,
  ObjectRecoveryV1,
  RecoveredSource,
  SourceRecoveryV1,
  WireRecoveryV1,
} from '../../contract/records/editor-recovery.js';
import type { ObjectDraft } from '../../contract/records/inspector.js';
import type { WireDraft } from '../../contract/records/wire-editor.js';
import type { Snapshot, StoredRecord } from '../../contract/records/owners.js';
import type { CollectionId } from '../../contract/brands.js';
import { mapResults } from '../editing/results.js';
import { isCollectionKey } from '../workspace/collection-key.js';

/** Why a base without exactly one live record of the collection is refused. */
const ONE_LIVE_COLLECTION = 'The captured base must contain exactly one live collection';

/** The workspace a base was read from. Cannot fail. */
export function baseWorkspace(base: EditingBase): Snapshot['workspace'] {
  return base.workspace;
}

/**
 * The one live record of `collection` in `base`. Fails with `invalid-recovery` when the base holds
 * no record or several records of it, or when its record is deleted.
 */
export function collectionRecord(
  base: EditingBase,
  collection: CollectionId,
): Result<StoredRecord> {
  const matches = records(base).filter((item) => isCollectionKey(item.key, collection));
  if (matches.length !== 1) return rejected(ONE_LIVE_COLLECTION);
  return liveRecord(matches[0]);
}

/**
 * `base` narrowed to the one collection a draft edits. A captured base must already be that
 * collection's live record; a snapshot must hold exactly one live record of it. Fails with
 * `invalid-recovery` otherwise.
 */
export function captureCollectionBase(
  base: EditingBase,
  collection: CollectionId,
): Result<CapturedCollectionBase> {
  if ('record' in base) return captureExisting(base, collection);
  return captureSnapshot(base, collection);
}

/**
 * The stored record of a source draft, with its base narrowed to its collection. Fails with
 * `invalid-recovery` when that base cannot be captured.
 */
export function encodeSourceRecovery(draft: RecoveredSource): Result<SourceRecoveryV1> {
  const base = captureCollectionBase(draft.base, draft.collection);
  if (!base.ok) return base;
  return {
    ok: true,
    value: {
      kind: 'source-draft',
      schemaVersion: 1,
      base: base.value,
      source: draft.source,
      generation: draft.generation,
      collection: draft.collection,
      edit: draft.edit,
    },
  };
}

/** Stored records of object drafts, all or none. Fails with the first draft's `invalid-recovery`. */
export function encodeObjectRecovery(
  drafts: readonly ObjectDraft[],
): Result<readonly ObjectRecoveryV1[]> {
  return mapResults(drafts, encodeObject);
}

/** Stored records of wire drafts, all or none. Fails with the first draft's `invalid-recovery`. */
export function encodeWireRecovery(
  drafts: readonly WireDraft[],
): Result<readonly WireRecoveryV1[]> {
  return mapResults(drafts, encodeWire);
}

/** Every record a base holds: the captured one, or the whole snapshot. */
function records(base: EditingBase): readonly StoredRecord[] {
  if ('record' in base) return [base.record];
  return base.records;
}

/** A captured base is kept only when it is already the live record of `collection`. */
function captureExisting(
  base: CapturedCollectionBase,
  collection: CollectionId,
): Result<CapturedCollectionBase> {
  if (!isLiveCollection(base.record, collection))
    return rejected('The captured collection identity does not match the draft');
  return { ok: true, value: base };
}

/** A snapshot is narrowed to its one live record of `collection`. */
function captureSnapshot(
  base: Snapshot,
  collection: CollectionId,
): Result<CapturedCollectionBase> {
  const record = collectionRecord(base, collection);
  if (!record.ok) return record;
  return {
    ok: true,
    value: {
      kind: 'captured-collection',
      schemaVersion: 1,
      workspace: base.workspace,
      sequence: base.sequence,
      record: record.value,
    },
  };
}

/** The only match, when it exists and is not deleted. */
function liveRecord(record: StoredRecord | undefined): Result<StoredRecord> {
  if (record === undefined) return rejected(ONE_LIVE_COLLECTION);
  if (record.deleted) return rejected('The captured collection must be live');
  return { ok: true, value: record };
}

/** Whether `record` is the live record of collection `collection`. */
function isLiveCollection(
  record: StoredRecord,
  collection: CollectionId,
): boolean {
  if (!isCollectionKey(record.key, collection)) return false;
  return !record.deleted;
}

/** One object draft's stored record. Fails with `invalid-recovery` when its base cannot be captured. */
function encodeObject(draft: ObjectDraft): Result<ObjectRecoveryV1> {
  const base = captureCollectionBase(draft.base, draft.collection.id);
  if (!base.ok) return base;
  return {
    ok: true,
    value: {
      kind: 'object-draft',
      schemaVersion: 1,
      base: base.value,
      key: draft.key,
      collection: draft.collection.id,
      object: draft.object.id,
      generation: draft.generation,
      edits: draft.edits,
    },
  };
}

/** One wire draft's stored record. Fails with `invalid-recovery` when its base cannot be captured. */
function encodeWire(draft: WireDraft): Result<WireRecoveryV1> {
  const base = captureCollectionBase(draft.base, draft.collection.id);
  if (!base.ok) return base;
  return {
    ok: true,
    value: {
      kind: 'wire-draft',
      schemaVersion: 1,
      base: base.value,
      key: draft.key,
      collection: draft.collection.id,
      section: draft.section.id,
      relationship: draft.relationship.id,
      generation: draft.generation,
      edits: draft.edits,
    },
  };
}

/** `invalid-recovery` with its own recovery text: repair the captured collection, keep the draft. */
function rejected(message: string): Extract<Result<never>, { ok: false }> {
  return {
    ok: false,
    error: diagnostic(
      'invalid-recovery',
      message,
      'Keep the draft and repair its captured collection before retrying recovery.',
    ),
  };
}
