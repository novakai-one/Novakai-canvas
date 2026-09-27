/*
 * Reads stored wire drafts, current and legacy. Pure: checks untrusted storage and never changes
 * it. One invalid draft fails the whole list; the wire editor session reports it and the stored
 * data is kept.
 */
import { z } from 'zod';
import { objectId, descendantId, relationshipKind, validate } from '@novakai/canvas-model';
import { snapshotSchema } from '@novakai/canvas-authoring';
import { transportGeneration } from '@novakai/canvas-service';
import type { WireDraft, WireEdit } from '../../contract/records/wire-editor.js';
import type {
  CapturedCollectionBase,
  EditingBase,
} from '../../contract/records/editor-recovery.js';
import type { Collection, StoredRecord } from '../../contract/records/owners.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { captureCollectionBase, mapResults, wireDraftKey } from '../../contract/api.js';
import {
  capturedCollectionBaseSchema,
  hasRecoveryTag,
} from '../../contract/schemas/editor-recovery.js';
/** Recovery admits unfinished text, but never arbitrary fields or untyped endpoint identities. */
const command: z.ZodType<WireEdit> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['label', 'guard', 'effect']), value: z.string() }),
  z.strictObject({ kind: z.literal('relationship-kind'), value: relationshipKind }),
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
/** Fields every stored wire draft has, in either shape. */
const draftFields = {
  key: z.string(),
  generation: transportGeneration,
  edits: z.array(command).readonly(),
};
/** An untagged draft from before schema version 1: a full snapshot and nested IDs. */
const legacyRecord = z.object({
  ...draftFields,
  base: snapshotSchema,
  collection: z.object({ id: z.string() }),
  section: z.object({ id: z.string() }),
  relationship: z.object({ id: z.string() }),
});
/** A tagged draft (schema version 1): a captured collection base and plain IDs. */
const currentRecord = z.strictObject({
  kind: z.literal('wire-draft'),
  schemaVersion: z.literal(1),
  ...draftFields,
  base: capturedCollectionBaseSchema,
  collection: z.string(),
  section: z.string(),
  relationship: z.string(),
});
/** A stored draft in one shape: plain IDs, and either kind of base. */
type RecoveryRecord = Omit<z.infer<typeof currentRecord>, 'kind' | 'schemaVersion' | 'base'> & {
  readonly base: EditingBase;
};
/** A draft whose base is narrowed to the one collection it edits. */
type CapturedRecord = RecoveryRecord & { readonly base: CapturedCollectionBase };

/**
 * Reads a stored list of wire drafts, all or none; a malformed entry cannot disappear unnoticed.
 * Fails with `invalid-wire-draft` when the list is unbounded or any draft is unreadable or does
 * not match its captured collection, or with the capture's `invalid-recovery` when a draft's base
 * has no live record of its collection.
 */
export function readWireDrafts(input: unknown): Result<readonly WireDraft[]> {
  const parsed = z.array(z.unknown()).max(1000).safeParse(input);
  if (!parsed.success) return invalid('Wire forms must be a bounded list');
  return mapResults(parsed.data, readDraft);
}
/**
 * One stored draft, with its originals recovered from the captured authoritative snapshot;
 * duplicated browser payloads never override them. Fails as {@link readWireDrafts} says.
 */
function readDraft(input: unknown): Result<WireDraft> {
  const value = normalizedRecord(input);
  if (!value.ok) return value;
  const record = value.value;
  const captured = captureCollectionBase(record.base, record.collection);
  if (!captured.ok) return captured;
  return capturedDraft({ ...record, base: captured.value });
}
/** A tagged draft is read as current, anything else as legacy. Fails with `invalid-wire-draft`. */
function normalizedRecord(input: unknown): Result<RecoveryRecord> {
  if (hasRecoveryTag(input)) return currentValue(input);
  return legacyValue(input);
}
/** A current draft already has the plain shape. Fails with `invalid-wire-draft`. */
function currentValue(input: unknown): Result<RecoveryRecord> {
  const parsed = currentRecord.safeParse(input);
  if (!parsed.success) return invalid('A retained wire form could not be read');
  return { ok: true, value: parsed.data };
}
/** A legacy draft's nested IDs become plain IDs. Fails with `invalid-wire-draft`. */
function legacyValue(input: unknown): Result<RecoveryRecord> {
  const parsed = legacyRecord.safeParse(input);
  if (!parsed.success) return invalid('A retained wire form could not be read');
  const record = parsed.data;
  return {
    ok: true,
    value: {
      ...record,
      collection: record.collection.id,
      section: record.section.id,
      relationship: record.relationship.id,
    },
  };
}
/** Model owns the validity of the captured base before any UI command is replayed. Fails with `invalid-wire-draft`. */
function capturedDraft(value: CapturedRecord): Result<WireDraft> {
  const collection = admitCollection(value.base.record, value.collection);
  if (!collection.ok) return collection;
  return originalWire(value, collection.value);
}
/**
 * The captured record's collection, when Model accepts it and it has the draft's collection ID and
 * the record's version. Capture has already checked the record is that collection's live record.
 * Fails with `invalid-wire-draft`.
 */
function admitCollection(
  record: StoredRecord,
  id: string,
): Result<Collection> {
  const collection = validate(record.value);
  if (!collection.ok) return invalid('The wire form has no valid captured collection');
  if (!isVersionOf(collection.value, id, record.version))
    return invalid('The captured collection identity or revision is invalid');
  return { ok: true, value: collection.value };
}
/** Whether the collection has ID `id` at revision `version`. */
function isVersionOf(
  collection: Collection,
  id: string,
  version: number,
): boolean {
  if (collection.id !== id) return false;
  return collection.revision === version;
}
/** Retained identities must resolve within the same section and collection. Fails with `invalid-wire-draft`. */
function originalWire(
  value: CapturedRecord,
  collection: Collection,
): Result<WireDraft> {
  const section = collection.sections.find((item) => item.id === value.section);
  const relationship = collection.relationships.find((item) => item.id === value.relationship);
  if (section === undefined) return invalid('The captured diagram is missing');
  if (relationship === undefined) return invalid('The captured relationship is missing');
  const wire = section.wires.find((item) => item.relationship === relationship.id);
  return checkedWire(value, collection, section, relationship, wire);
}
/**
 * The draft, when its wire exists and its key is the one its identities rebuild. The generated
 * Canvas target is not needed: Model submission uses only canonical identity. Fails with
 * `invalid-wire-draft`.
 */
function checkedWire(
  value: CapturedRecord,
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
/** `invalid-wire-draft`. Corrupt retention stays for explicit recovery; the reader never overwrites it. */
function invalid(message: string): Extract<Result<never>, { ok: false }> {
  return failure('invalid-wire-draft', `${message}; stored data was retained`);
}
