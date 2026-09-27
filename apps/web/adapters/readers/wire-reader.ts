import { z } from 'zod';
import { objectId, descendantId, validate } from '@novakai/canvas-model';
import { snapshotSchema } from '@novakai/canvas-authoring';
import { transportGeneration } from '@novakai/canvas-service';
import type { WireDraft, WireEdit } from '../../contract/records/wire-editor.js';
import type {
  CapturedCollectionBase,
  EditingBase,
} from '../../contract/records/editor-recovery.js';
import type { Collection } from '../../contract/records/owners.js';
import type { StoredRecord } from '../../contract/records/owners.js';
import type { TransportGeneration } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { captureCollectionBase, wireDraftKey } from '../../contract/api.js';
import {
  capturedCollectionBaseSchema,
  hasRecoveryTag,
} from '../../contract/schemas/editor-recovery.js';
/** Recovery admits unfinished text, but never arbitrary fields or untyped endpoint identities. */
const command: z.ZodType<WireEdit> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['label', 'guard', 'effect']), value: z.string() }),
  z.strictObject({
    kind: z.literal('relationship-kind'),
    value: z.enum([
      'flow',
      'association',
      'imports',
      'calls',
      'implements',
      'contains',
      'parent',
      'reference',
      'transition',
    ]),
  }),
  z.strictObject({ kind: z.literal('style'), value: z.enum(['solid', 'dashed']) }),
  z.strictObject({
    kind: z.literal('endpoint'),
    side: z.enum(['source', 'target']),
    value: z.strictObject({ object: objectId, member: descendantId.optional() }),
  }),
  z.strictObject({
    kind: z.literal('cardinality'),
    side: z.enum(['from', 'to']),
    value: z.enum(['none', '0..1', '1', '0..many', '1..many']),
  }),
  z.strictObject({ kind: z.literal('route'), value: z.enum(['orthogonal', 'curve']) }),
  z.strictObject({ kind: z.literal('locked'), value: z.boolean() }),
  z.strictObject({
    kind: z.literal('side'),
    side: z.enum(['sourceSide', 'targetSide']),
    value: z.enum(['auto', 'top', 'right', 'bottom', 'left']),
  }),
  z.strictObject({ kind: z.literal('automatic-route') }),
]);
const legacyRecord = z.object({
  key: z.string(),
  base: snapshotSchema,
  generation: transportGeneration,
  collection: z.object({ id: z.string() }),
  section: z.object({ id: z.string() }),
  relationship: z.object({ id: z.string() }),
  edits: z.array(command).readonly(),
});
const currentRecord = z.strictObject({
  kind: z.literal('wire-draft'),
  schemaVersion: z.literal(1),
  key: z.string(),
  base: capturedCollectionBaseSchema,
  generation: transportGeneration,
  collection: z.string(),
  section: z.string(),
  relationship: z.string(),
  edits: z.array(command).readonly(),
});
interface RecoveryRecord {
  readonly key: string;
  readonly base: EditingBase;
  readonly generation: TransportGeneration;
  readonly collection: string;
  readonly section: string;
  readonly relationship: string;
  readonly edits: readonly WireEdit[];
}
/** Recover originals from the captured authoritative snapshot; duplicated browser payloads never override them. */
function readDraft(input: unknown): Result<WireDraft> {
  const value = normalizedRecord(input);
  if (!value.ok) return value;
  const record = value.value;
  const captured = captureCollectionBase(record.base, record.collection);
  if (!captured.ok) return captured;
  return capturedDraft({ ...record, base: captured.value });
}
function normalizedRecord(input: unknown): Result<RecoveryRecord> {
  const parsed = parseRecord(input);
  if (!parsed.success) return invalid('A retained wire form could not be read');
  return 'kind' in parsed.data ? currentValue(parsed.data) : legacyValue(parsed.data);
}
function parseRecord(input: unknown) {
  return hasRecoveryTag(input) ? currentRecord.safeParse(input) : legacyRecord.safeParse(input);
}
function currentValue(input: z.infer<typeof currentRecord>): Result<RecoveryRecord> {
  return { ok: true, value: input };
}
function legacyValue(input: z.infer<typeof legacyRecord>): Result<RecoveryRecord> {
  return {
    ok: true,
    value: {
      ...input,
      collection: input.collection.id,
      section: input.section.id,
      relationship: input.relationship.id,
    },
  };
}
/** Model owns the validity of the captured base before any UI command is replayed. */
function capturedDraft(
  value: RecoveryRecord & { readonly base: CapturedCollectionBase },
): Result<WireDraft> {
  const original = value.base.record;
  const collection = admitCollection(original, value.collection);
  if (!collection.ok) return collection;
  return originalWire(value, collection.value);
}
function admitCollection(
  record: StoredRecord,
  id: string,
): Result<Collection> {
  if (!isLiveCollection(record, id))
    return invalid('The wire form has no valid captured collection');
  const collection = validate(record.value);
  if (!collection.ok) return invalid('The wire form has no valid captured collection');
  return checkedCollection(collection.value, id, record.version);
}
function checkedCollection(
  collection: Collection,
  id: string,
  version: number,
): Result<Collection> {
  if (!matchesRecord(collection.id, collection.revision, id, version))
    return invalid('The captured collection identity or revision is invalid');
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
/** Retained identities must resolve within the same section and collection. */
function originalWire(
  value: RecoveryRecord & { readonly base: CapturedCollectionBase },
  collection: Collection,
): Result<WireDraft> {
  const section = collection.sections.find((item) => item.id === value.section);
  const relationship = collection.relationships.find((item) => item.id === value.relationship);
  if (section === undefined) return invalid('The captured diagram is missing');
  if (relationship === undefined) return invalid('The captured relationship is missing');
  const wire = section.wires.find((item) => item.relationship === relationship.id);
  return checkedWire(value, collection, section, relationship, wire);
}
/** The generated Canvas target is not needed for recovery: Model submission uses only canonical identity. */
function checkedWire(
  value: RecoveryRecord & { readonly base: CapturedCollectionBase },
  collection: Collection,
  section: WireDraft['section'],
  relationship: WireDraft['relationship'],
  wire: WireDraft['wire'] | undefined,
): Result<WireDraft> {
  if (wire === undefined) return invalid('The captured wire appearance is missing');
  const key = wireDraftKey(collection.id, section.id, relationship.id);
  if (key !== value.key)
    return invalid('The retained wire identity does not match its captured scope');
  return {
    ok: true,
    value: {
      key: value.key,
      base: value.base,
      generation: value.generation,
      collection,
      section,
      relationship,
      wire,
      edits: value.edits,
    },
  };
}
/** Corrupt retention remains available for explicit recovery; it is never overwritten by the reader. */
function invalid(message: string): Result<never> {
  return failure('invalid-wire-draft', `${message}; stored data was retained`);
}
/** Read all forms atomically; a malformed entry cannot disappear unnoticed. */
export function readWireDrafts(input: unknown): Result<readonly WireDraft[]> {
  const parsed = z.array(z.unknown()).max(1000).safeParse(input);
  if (!parsed.success) return invalid('Wire forms must be a bounded list');
  const results = parsed.data.map(readDraft);
  const rejected = results.find((result) => !result.ok);
  if (rejected) return rejected;
  return { ok: true, value: results.flatMap((result) => (result.ok ? [result.value] : [])) };
}
