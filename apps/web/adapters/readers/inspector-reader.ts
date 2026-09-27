/*
 * Reads stored inspector (object) drafts, current and legacy. Pure: checks untrusted storage and
 * never changes it. One invalid draft fails the whole list; the inspector session reports it and
 * the stored data is kept.
 */
import { z } from 'zod';
import {
  collectionId,
  descendantId,
  objectId,
  definitionId,
  validate,
} from '@novakai/canvas-model';
import { snapshotSchema } from '@novakai/canvas-authoring';
import { transportGeneration } from '@novakai/canvas-service';
import type { ObjectDraft, ObjectEdit } from '../../contract/records/inspector.js';
import type {
  CapturedCollectionBase,
  EditingBase,
} from '../../contract/records/editor-recovery.js';
import type { StoredRecord } from '../../contract/records/owners.js';
import type { CollectionId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { captureCollectionBase, mapResults, objectDraftKey } from '../../contract/api.js';
import {
  capturedCollectionBaseSchema,
  hasRecoveryTag,
} from '../../contract/schemas/editor-recovery.js';
/** Draft command schemas admit unfinished strings; they do not claim domain validity. */
const command: z.ZodType<ObjectEdit> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['label', 'role']), value: z.string() }),
  z.strictObject({ kind: z.literal('size'), value: z.enum(['small', 'medium', 'large']) }),
  z.strictObject({
    kind: z.literal('notation'),
    value: z.enum([
      'step',
      'start',
      'end',
      'decision',
      'fork',
      'join',
      'entity',
      'module',
      'interface',
      'function',
      'state',
      'participant',
      'concept',
      'system',
      'note',
    ]),
  }),
  z.strictObject({
    kind: z.literal('content-text'),
    id: descendantId,
    field: z.enum(['label', 'type', 'text', 'returns']),
    value: z.string(),
  }),
  z.strictObject({
    kind: z.literal('field-key'),
    id: descendantId,
    value: z.enum(['none', 'primary', 'foreign', 'unique']),
  }),
  z.strictObject({
    kind: z.literal('field-reference'),
    id: descendantId,
    target: z.strictObject({ object: objectId, member: descendantId.optional() }),
  }),
  z.strictObject({
    kind: z.literal('field-type'),
    id: descendantId,
    value: z.union([
      z.string(),
      z.strictObject({ kind: z.literal('definition'), id: definitionId }),
    ]),
  }),
  z.strictObject({
    kind: z.literal('parameters'),
    id: descendantId,
    value: z.array(z.string()).readonly(),
  }),
  z.strictObject({ kind: z.literal('nullable'), id: descendantId, value: z.boolean() }),
  z.strictObject({ kind: z.literal('remove-content'), id: descendantId }),
  z.strictObject({
    kind: z.literal('add-content'),
    id: descendantId,
    content: z.enum(['text', 'field', 'member', 'signature']),
  }),
]);
/** Why a stored draft with neither the current nor the legacy shape is refused. */
const UNREADABLE = 'An inspector draft could not be read; stored data was retained';
/** Fields every stored object draft has, in either shape. */
const draftFields = {
  key: z.string(),
  generation: transportGeneration,
  edits: z.array(command).readonly(),
};
/** An untagged draft from before schema version 1: a full snapshot and nested IDs. */
const legacyDraftRecord = z.object({
  ...draftFields,
  base: snapshotSchema,
  collection: z.object({ id: collectionId }),
  object: z.object({ id: objectId }),
});
/** A tagged draft (schema version 1): a captured collection base and plain IDs. */
const currentDraftRecord = z.strictObject({
  kind: z.literal('object-draft'),
  schemaVersion: z.literal(1),
  ...draftFields,
  base: capturedCollectionBaseSchema,
  collection: collectionId,
  object: objectId,
});
/** A stored draft in one shape: plain IDs, and either kind of base. */
type RecoveryRecord = Omit<
  z.infer<typeof currentDraftRecord>,
  'kind' | 'schemaVersion' | 'base'
> & { readonly base: EditingBase };
/** A draft whose base is narrowed to the one collection it edits. */
type CapturedRecord = RecoveryRecord & { readonly base: CapturedCollectionBase };

/**
 * Reads a stored list of inspector drafts, all or none; malformed records never silently
 * disappear. Fails with `invalid-inspector-draft` when the list is unbounded or any draft is
 * unreadable, or with the capture's `invalid-recovery` when a draft's base has no live record of
 * its collection.
 */
export function readInspectorDrafts(input: unknown): Result<readonly ObjectDraft[]> {
  const parsed = z.array(z.unknown()).max(1000).safeParse(input);
  if (!parsed.success) return invalid('Stored inspector drafts must be a bounded list');
  return mapResults(parsed.data, readRecord);
}
/**
 * One stored draft, with its original recovered from Model's checked collection, never from an
 * untrusted duplicate object payload. Fails as {@link readInspectorDrafts} says.
 */
function readRecord(input: unknown): Result<ObjectDraft> {
  const record = normalizedRecord(input);
  if (!record.ok) return record;
  const value = record.value;
  const captured = captureCollectionBase(value.base, value.collection);
  if (!captured.ok) return captured;
  return readCapturedCollection({ ...value, base: captured.value });
}
/** A tagged draft is read as current, anything else as legacy. Fails with `invalid-inspector-draft`. */
function normalizedRecord(input: unknown): Result<RecoveryRecord> {
  if (hasRecoveryTag(input)) return currentRecord(input);
  return legacyRecord(input);
}
/** A current draft already has the plain shape. Fails with `invalid-inspector-draft`. */
function currentRecord(input: unknown): Result<RecoveryRecord> {
  const parsed = currentDraftRecord.safeParse(input);
  if (!parsed.success) return invalid(UNREADABLE);
  return { ok: true, value: parsed.data };
}
/** A legacy draft's nested IDs become plain IDs. Fails with `invalid-inspector-draft`. */
function legacyRecord(input: unknown): Result<RecoveryRecord> {
  const parsed = legacyDraftRecord.safeParse(input);
  if (!parsed.success) return invalid(UNREADABLE);
  const record = parsed.data;
  return {
    ok: true,
    value: { ...record, collection: record.collection.id, object: record.object.id },
  };
}
/** `invalid-inspector-draft`: the stored draft cannot be used; it stays stored. */
function invalid(message: string): Extract<Result<never>, { ok: false }> {
  return failure('invalid-inspector-draft', message);
}
/**
 * The draft checked against its captured record; duplicated client collection data cannot replace
 * its versioned base. Fails with `invalid-inspector-draft`.
 */
function readCapturedCollection(record: CapturedRecord): Result<ObjectDraft> {
  const collection = admitCollection(record.base.record, record.collection);
  if (!collection.ok) return collection;
  return readOriginal(record, collection.value);
}
/**
 * The captured record's collection, when Model accepts it and it has the draft's collection ID and
 * the record's version. Capture has already checked the record is that collection's live record.
 * Fails with `invalid-inspector-draft`.
 */
function admitCollection(
  record: StoredRecord,
  id: CollectionId,
): Result<ObjectDraft['collection']> {
  const collection = validate(record.value);
  if (!collection.ok) return invalid('The draft base is not a valid collection');
  if (!isVersionOf(collection.value, id, record.version))
    return invalid('The draft collection identity or revision is invalid');
  return { ok: true, value: collection.value };
}
/** Whether the collection has ID `id` at revision `version`. */
function isVersionOf(
  collection: ObjectDraft['collection'],
  id: CollectionId,
  version: number,
): boolean {
  if (collection.id !== id) return false;
  return collection.revision === version;
}
/**
 * The draft with its original object. Identity is rebuilt from admitted data, so a stored key
 * cannot alias another object's draft. Fails with `invalid-inspector-draft`.
 */
function readOriginal(
  record: CapturedRecord,
  collection: ObjectDraft['collection'],
): Result<ObjectDraft> {
  const object = collection.objects.find((item) => item.id === record.object);
  if (!object) return invalid('The draft object is absent from its original collection');
  const key = objectDraftKey(collection.id, object.id);
  if (key !== record.key) return invalid('The draft identity does not match its object');
  return {
    ok: true,
    value: {
      key: record.key,
      base: record.base,
      generation: record.generation,
      collection,
      object,
      edits: record.edits,
    },
  };
}
