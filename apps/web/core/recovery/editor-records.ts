import { diagnostic, type Result } from '../../contract/errors.js';
import type {
  CapturedCollectionBase,
  EditingBase,
  ObjectRecoveryV1,
  SourceRecoveryV1,
  WireRecoveryV1,
} from '../../contract/records/editor-recovery.js';
import type { ObjectDraft } from '../../contract/records/inspector.js';
import type { WireDraft } from '../../contract/records/wire-editor.js';
import type { Snapshot, StoredRecord } from '../../contract/records/owners.js';
import type { TransportGeneration } from '../../contract/brands.js';

/** `invalid-recovery`: a retained draft's captured collection cannot be used. */
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

function records(base: EditingBase): readonly StoredRecord[] {
  return 'record' in base ? [base.record] : base.records;
}

export function baseWorkspace(base: EditingBase): Snapshot['workspace'] {
  return base.workspace;
}

export function collectionRecord(
  base: EditingBase,
  collection: string,
): Result<StoredRecord> {
  const matches = records(base).filter(
    (item) => item.key.kind === 'collection' && item.key.id === collection,
  );
  if (matches.length !== 1)
    return rejected('The captured base must contain exactly one live collection');
  return collectionMatch(matches[0]);
}
function collectionMatch(record: StoredRecord | undefined): Result<StoredRecord> {
  if (record === undefined)
    return rejected('The captured base must contain exactly one live collection');
  if (!liveCollection(record)) return rejected('The captured collection must be live');
  return { ok: true, value: record };
}

export function captureCollectionBase(
  base: EditingBase,
  collection: string,
): Result<CapturedCollectionBase> {
  return 'record' in base ? captureExisting(base, collection) : captureSnapshot(base, collection);
}
function captureExisting(
  base: CapturedCollectionBase,
  collection: string,
): Result<CapturedCollectionBase> {
  if (!isCapturedCollection(base.record, collection))
    return rejected('The captured collection identity does not match the draft');
  return { ok: true, value: base };
}
function captureSnapshot(
  base: Snapshot,
  collection: string,
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
function liveCollection(record: StoredRecord): boolean {
  if (record.key.kind !== 'collection') return false;
  return !record.deleted;
}
function isCapturedCollection(
  record: StoredRecord,
  collection: string,
): boolean {
  if (record.key.kind !== 'collection') return false;
  if (record.key.id !== collection) return false;
  return !record.deleted;
}

export interface SourceRecoveryInput {
  readonly source: string;
  readonly base: EditingBase | null;
  readonly generation: TransportGeneration;
  readonly collection: string;
  readonly edit: number;
}

export function encodeSourceRecovery(input: SourceRecoveryInput): Result<SourceRecoveryV1> {
  if (input.base === null) return rejected('Source has no captured base');
  const base = captureCollectionBase(input.base, input.collection);
  if (!base.ok) return base;
  return {
    ok: true,
    value: {
      kind: 'source-draft',
      schemaVersion: 1,
      base: base.value,
      source: input.source,
      generation: input.generation,
      collection: input.collection,
      edit: input.edit,
    },
  };
}

export function encodeObjectRecovery(
  drafts: readonly ObjectDraft[],
): Result<readonly ObjectRecoveryV1[]> {
  const encoded = drafts.map(encodeObject);
  const rejectedResult = encoded.find((item) => !item.ok);
  if (rejectedResult !== undefined && !rejectedResult.ok) return rejectedResult;
  return { ok: true, value: encoded.flatMap((item) => (item.ok ? [item.value] : [])) };
}

export function encodeWireRecovery(
  drafts: readonly WireDraft[],
): Result<readonly WireRecoveryV1[]> {
  const encoded = drafts.map(encodeWire);
  const rejectedResult = encoded.find((item) => !item.ok);
  if (rejectedResult !== undefined && !rejectedResult.ok) return rejectedResult;
  return { ok: true, value: encoded.flatMap((item) => (item.ok ? [item.value] : [])) };
}

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
