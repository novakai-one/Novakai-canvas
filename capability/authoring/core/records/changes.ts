import type {
  Snapshot,
  Write,
  StoredRecord,
  Json,
  RecordKey,
} from '../../contract/records/storage.js';
import { findRecord, isVersionedDocument, keyText } from './keys.js';
import { canonical } from '../identity/canonical.js';
import { reject } from '../validation/outcomes.js';

/** A write that stores a value, as opposed to a delete. */
type PutWrite = Extract<Write, { kind: 'put' }>;

/**
 * Turns one planned write into the write that storage will actually receive.
 *
 * - A write that would change nothing becomes no write at all.
 * - A put is normalized: its resource list is de-duplicated and sorted, and a versioned
 *   document gets its `revision` header set to the new storage version.
 * - A delete of a live record is kept as it is.
 *
 * Each returned write creates exactly one new version of its record.
 * Storage is not touched here; Authoring commits the result later as one transaction.
 *
 * @param snapshot - The current workspace snapshot.
 * @param write - The planned write.
 * @returns An empty list when the write changes nothing, otherwise a list with the one normalized write.
 * @throws AuthoringFault `invalid-input` when the record's revision is already at the largest safe integer,
 *   or when a versioned document's payload is not a JSON object.
 * @throws AuthoringFault `invariant-violation` when a versioned document's `id` differs from its key.
 */
export function netWrite(
  snapshot: Snapshot,
  write: Write,
): readonly Write[] {
  const previous = findRecord(snapshot, write.key);
  if (writeChangesNothing(previous, write)) return [];

  // Computed for deletes too, so that deleting a record whose revision is exhausted is also rejected.
  const version = nextVersion(previous);

  if (write.kind === 'delete') return [write];
  return [normalizePut(write, version)];
}

/**
 * Builds the record that storage will hold after one write, without storing anything.
 *
 * Validation and history use this to see the exact result of a change before it is committed.
 *
 * @param snapshot - The workspace snapshot before the write.
 * @param write - The write to apply.
 * @returns The stored record after the write. A delete produces a tombstone with a `null` value.
 * @throws AuthoringFault `invalid-input` when the record's revision is already at the largest safe integer.
 */
export function nextRecord(
  snapshot: Snapshot,
  write: Write,
): StoredRecord {
  const previous = findRecord(snapshot, write.key);
  const version = nextVersion(previous);

  if (write.kind === 'delete') {
    return { key: write.key, version, value: null, deleted: true, resources: [] };
  }
  return {
    key: write.key,
    version,
    value: write.value,
    deleted: false,
    resources: write.resources,
  };
}

/**
 * Builds the snapshot that storage will hold after a set of writes, without storing anything.
 *
 * Records the writes do not touch, including tombstones, are kept unchanged.
 * Written records move to the end of the record list.
 * The snapshot's `sequence` number is not changed.
 *
 * @param snapshot - The workspace snapshot before the writes.
 * @param writes - The writes to apply. Callers check beforehand that each key appears at most once;
 *   this function does not.
 * @returns A new snapshot. The input snapshot is not modified.
 * @throws AuthoringFault `invalid-input` when a written record's revision is already at the largest safe integer.
 */
export function installWrites(
  snapshot: Snapshot,
  writes: readonly Write[],
): Snapshot {
  const writtenKeys = new Set(writes.map((write) => keyText(write.key)));
  const untouchedRecords = snapshot.records.filter(
    (record) => !writtenKeys.has(keyText(record.key)),
  );
  const writtenRecords = writes.map((write) => nextRecord(snapshot, write));
  return {
    ...snapshot,
    records: [...untouchedRecords, ...writtenRecords],
  };
}

/** Tells whether a write would leave the stored record exactly as it is. */
function writeChangesNothing(
  previous: StoredRecord | null,
  write: Write,
): boolean {
  if (write.kind === 'put') return putChangesNothing(previous, write);
  return deleteChangesNothing(previous);
}

/** A delete changes nothing when the record was never stored or is already deleted. */
function deleteChangesNothing(previous: StoredRecord | null): boolean {
  if (previous === null) return true;
  return previous.deleted;
}

/**
 * A put changes nothing when the live record already holds the same normalized value and resources.
 * The comparison uses the record's current revision, so no revision is spent on an unchanged put.
 */
function putChangesNothing(
  previous: StoredRecord | null,
  write: PutWrite,
): boolean {
  if (previous === null) return false;
  if (previous.deleted) return false;

  const normalizedWrite = normalizePut(write, previous.version);
  const currentAsWrite = {
    kind: 'put',
    key: previous.key,
    value: previous.value,
    resources: [...previous.resources].toSorted(),
  };
  return canonical(normalizedWrite) === canonical(currentAsWrite);
}

/**
 * Returns the storage version a record will have after its next write.
 * A record that was never stored starts at version `0`.
 */
function nextVersion(previous: StoredRecord | null): number {
  if (previous === null) return 0;
  if (previous.version === Number.MAX_SAFE_INTEGER)
    reject('invalid-input', 'version', 'Record revision exhausted');
  return previous.version + 1;
}

/**
 * Normalizes a put for storage.
 * Resources are treated as a set, so their order or repetition never creates a new revision.
 */
function normalizePut(
  write: PutWrite,
  version: number,
): Write {
  const stampedValue = stampRevision(write.key, write.value, version);
  const uniqueResources = [...new Set(write.resources)];
  return {
    ...write,
    value: stampedValue,
    resources: uniqueResources.toSorted(),
  };
}

/**
 * Sets a versioned document's `revision` header to its storage version, after checking its `id`.
 * Any revision the author submitted is overwritten; it is never used as a write precondition.
 * Payloads of other record kinds are returned unchanged.
 */
function stampRevision(
  key: RecordKey,
  value: Json,
  version: number,
): Json {
  if (!isVersionedDocument(key.kind)) return value;

  const fields = documentFields(value);
  if (fields.id !== key.id)
    reject('invariant-violation', keyText(key), 'Document identity differs from its storage key');
  return { ...fields, revision: version };
}

/** Reads a versioned document payload as a plain object of fields. */
function documentFields(value: Json): Readonly<Record<string, Json>> {
  if (value === null || typeof value !== 'object')
    reject('invalid-input', 'value', 'Versioned documents require object payloads');
  if (Array.isArray(value))
    reject('invalid-input', 'value', 'Versioned documents cannot be arrays');
  return Object.fromEntries(Object.entries(value));
}
