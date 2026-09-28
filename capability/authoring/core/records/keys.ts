import type {
  RecordKey,
  Snapshot,
  StoredRecord,
  ReadVersion,
} from '../../contract/records/storage.js';

/** Record kinds whose JSON payload carries its own `id` and `revision` header. */
const VERSIONED_DOCUMENT_KINDS: ReadonlySet<RecordKey['kind']> = new Set(['collection', 'catalog']);

/**
 * Builds the text form of a record key. Authoring uses it to compare keys and to name a key in errors.
 *
 * The kind is part of the text, so two records with the same id but different kinds never match.
 * A checked kind name never contains `/`, so the text form cannot collide.
 *
 * @param key - The record key to describe.
 * @returns The key as `kind/id`, for example `collection/sales`.
 */
export function keyText(key: RecordKey): string {
  return `${key.kind}/${key.id}`;
}

/**
 * Finds the stored record with the given key.
 *
 * A deleted record (tombstone) is still found. Only a key that was never stored is missing.
 *
 * @param snapshot - The workspace snapshot to search.
 * @param key - The record key to look for.
 * @returns The stored record, or `null` when the snapshot has never stored this key.
 */
export function findRecord(
  snapshot: Snapshot,
  key: RecordKey,
): StoredRecord | null {
  const wantedKey = keyText(key);
  const record = snapshot.records.find((candidate) => keyText(candidate.key) === wantedKey);
  if (record === undefined) return null;
  return record;
}

/**
 * Reads the current version of one record key.
 *
 * `'absent'` means no record is stored under the key: it was never stored, or it was a purged history
 * record. It does not mean "deleted", and it is not revision `0`.
 *
 * @param snapshot - The workspace snapshot to read.
 * @param key - The record key to read.
 * @returns The key with its stored version, or with `'absent'` when no record is stored under it.
 */
export function versionOf(
  snapshot: Snapshot,
  key: RecordKey,
): ReadVersion {
  const record = findRecord(snapshot, key);
  if (record === null) return { key, version: 'absent' };
  return { key, version: record.version };
}

/**
 * Tells whether a record kind is a versioned document.
 *
 * A versioned document (a collection or a catalog) stores its own `id` and `revision` inside its JSON
 * payload. Authoring keeps that header equal to the storage key and the storage version.
 * Every other kind has an owner-defined payload that Authoring does not inspect.
 *
 * @param kind - The record kind to test.
 * @returns `true` for `collection` and `catalog` records.
 */
export function isVersionedDocument(kind: RecordKey['kind']): boolean {
  return VERSIONED_DOCUMENT_KINDS.has(kind);
}
