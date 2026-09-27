import { z } from 'zod';
import { descendantId, objectId, definitionId, validate } from '@novakai/canvas-model';
import { snapshotSchema } from '@novakai/canvas-authoring';
import { transportGeneration } from '@novakai/canvas-service';
import type { ObjectDraft, ObjectEdit } from '../../contract/records/inspector.js';
import type {
  CapturedCollectionBase,
  EditingBase,
} from '../../contract/records/editor-recovery.js';
import type { StoredRecord } from '../../contract/records/owners.js';
import type { TransportGeneration } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { captureCollectionBase, objectDraftKey } from '../../contract/api.js';
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
const legacyDraftRecord = z.object({
  key: z.string(),
  base: snapshotSchema,
  generation: transportGeneration,
  collection: z.object({ id: z.string() }),
  object: z.object({ id: z.string() }),
  edits: z.array(command).readonly(),
});
const currentDraftRecord = z.strictObject({
  kind: z.literal('object-draft'),
  schemaVersion: z.literal(1),
  key: z.string(),
  base: capturedCollectionBaseSchema,
  generation: transportGeneration,
  collection: z.string(),
  object: z.string(),
  edits: z.array(command).readonly(),
});
interface RecoveryRecord {
  readonly key: string;
  readonly base: EditingBase;
  readonly generation: TransportGeneration;
  readonly collection: string;
  readonly object: string;
  readonly edits: readonly ObjectEdit[];
}
/** A stored original is recovered from Model's checked collection, never from an untrusted duplicate object payload. */
function readRecord(input: unknown): Result<ObjectDraft> {
  const record = normalizedRecord(input);
  if (!record.ok) return record;
  const value = record.value;
  const captured = captureCollectionBase(value.base, value.collection);
  if (!captured.ok) return captured;
  return readCapturedCollection({ ...value, base: captured.value });
}
function normalizedRecord(input: unknown): Result<RecoveryRecord> {
  const parsed = parseRecord(input);
  if (!parsed.success)
    return failure(
      'invalid-inspector-draft',
      'An inspector draft could not be read; stored data was retained',
    );
  return 'kind' in parsed.data ? currentRecord(parsed.data) : legacyRecord(parsed.data);
}
function parseRecord(input: unknown) {
  return hasRecoveryTag(input)
    ? currentDraftRecord.safeParse(input)
    : legacyDraftRecord.safeParse(input);
}
function currentRecord(input: z.infer<typeof currentDraftRecord>): Result<RecoveryRecord> {
  return {
    ok: true,
    value: {
      key: input.key,
      base: input.base,
      generation: input.generation,
      collection: input.collection,
      object: input.object,
      edits: input.edits,
    },
  };
}
function legacyRecord(input: z.infer<typeof legacyDraftRecord>): Result<RecoveryRecord> {
  return {
    ok: true,
    value: {
      key: input.key,
      base: input.base,
      generation: input.generation,
      collection: input.collection.id,
      object: input.object.id,
      edits: input.edits,
    },
  };
}
/** Recover from the captured authoritative record; duplicated client collection data cannot replace its versioned base. */
function readCapturedCollection(
  record: RecoveryRecord & { readonly base: CapturedCollectionBase },
): Result<ObjectDraft> {
  const original = record.base.record;
  const collection = admitCollection(original, record.collection);
  if (!collection.ok) return collection;
  return readOriginal(record, collection.value);
}
function admitCollection(
  record: StoredRecord,
  id: string,
): Result<ObjectDraft['collection']> {
  if (!isLiveCollection(record, id))
    return failure('invalid-inspector-draft', 'The draft base does not contain its collection');
  const collection = validate(record.value);
  if (!collection.ok)
    return failure('invalid-inspector-draft', 'The draft base is not a valid collection');
  return checkedCollection(collection.value, id, record.version);
}
function checkedCollection(
  collection: ObjectDraft['collection'],
  id: string,
  version: number,
): Result<ObjectDraft['collection']> {
  if (!matchesRecord(collection.id, collection.revision, id, version))
    return failure(
      'invalid-inspector-draft',
      'The draft collection identity or revision is invalid',
    );
  return { ok: true, value: collection };
}
function isLiveCollection(
  record: StoredRecord,
  id: string,
): boolean {
  if (record.key.kind !== 'collection') return false;
  if (record.key.id !== id) return false;
  return !record.deleted;
}
function matchesRecord(
  id: string,
  revision: number,
  expectedId: string,
  expectedRevision: number,
): boolean {
  if (id !== expectedId) return false;
  return revision === expectedRevision;
}
/** Identity is reconstructed from admitted data, preventing a stored key from aliasing another object's draft. */
function readOriginal(
  record: RecoveryRecord & { readonly base: CapturedCollectionBase },
  collection: ObjectDraft['collection'],
): Result<ObjectDraft> {
  const object = collection.objects.find((item) => item.id === record.object);
  if (!object)
    return failure(
      'invalid-inspector-draft',
      'The draft object is absent from its original collection',
    );
  const key = objectDraftKey(collection.id, object.id);
  if (key !== record.key)
    return failure('invalid-inspector-draft', 'The draft identity does not match its object');
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
/** Each independently checked draft is returned atomically; malformed records never silently disappear. */
export function readInspectorDrafts(input: unknown): Result<readonly ObjectDraft[]> {
  const parsed = z.array(z.unknown()).max(1000).safeParse(input);
  if (!parsed.success)
    return failure('invalid-inspector-draft', 'Stored inspector drafts must be a bounded list');
  const results = parsed.data.map(readRecord);
  const rejected = results.find((result) => !result.ok);
  if (rejected) return rejected;
  return { ok: true, value: results.flatMap((result) => (result.ok ? [result.value] : [])) };
}
