import { snapshotSchema, receiptSchema, storedSchema } from '../../contract/records/storage.js';
import type { Snapshot, Receipt, StoredRecord } from '../../contract/records/storage.js';
import type { WorkspaceId, RequestId } from '../../contract/brands.js';
import { isVersionedDocument } from '../records/keys.js';
import { uniqueKeys } from '../records/versions.js';
import { readShape } from './input.js';
import { isFrozenObject, storedLimits } from './plain-data.js';
import { reject, freeze } from './outcomes.js';

/** Frozen snapshots whose records already passed every check in `checkRecords`. */
const checkedSnapshots = new WeakSet<object>();

/** Maps a frozen snapshot input object to the snapshot parsed from it. */
const envelopes = new WeakMap<object, Snapshot>();

/**
 * Reads and checks a workspace snapshot returned by storage.
 *
 * Beyond its shape, the snapshot must belong to the requested workspace and its records must
 * agree with each other: no record key twice, tombstones empty, and every live versioned
 * document's `id` and `revision` equal to its key and storage version.
 * Frozen snapshots are checked once and then reused.
 *
 * @param input - The untrusted snapshot from storage.
 * @param workspace - The workspace the snapshot must belong to.
 * @returns The checked, deeply frozen snapshot.
 * @throws AuthoringFault `invalid-input` at `$` when the snapshot is not plain JSON or is over the stored size limits.
 * @throws AuthoringFault `corrupt-record` when the snapshot does not match the snapshot shape, belongs to another
 *   workspace, has a malformed tombstone, or has a versioned document header that differs from its record.
 * @throws AuthoringFault `invalid-input` at `records` when a record key appears twice.
 */
export function readSnapshot(
  input: unknown,
  workspace: WorkspaceId,
): Snapshot {
  const snapshot = readEnvelope(input);
  if (snapshot.workspace !== workspace)
    reject('corrupt-record', 'workspace', 'Snapshot belongs to a different workspace');
  if (checkedSnapshots.has(snapshot)) return snapshot;

  checkRecords(snapshot);
  return snapshot;
}

/**
 * Reads and checks a stored receipt before any caller sees the outcome it records.
 *
 * @param input - The untrusted receipt from storage.
 * @param request - The request ID the receipt must belong to.
 * @returns The checked, deeply frozen receipt.
 * @throws AuthoringFault `invalid-input` at `$` when the receipt is not plain JSON or is over the stored size limits.
 * @throws AuthoringFault `corrupt-record` when the receipt does not match the receipt shape or belongs to another request.
 * @throws AuthoringFault `invalid-input` at `receipt.versions` when a record key appears twice.
 */
export function readReceipt(
  input: unknown,
  request: RequestId,
): Receipt {
  const receipt = readShape(receiptSchema, input, 'corrupt-record', storedLimits);
  if (receipt.request !== request)
    reject('corrupt-record', 'request', 'Receipt belongs to a different request');

  const versionKeys = receipt.versions.map((read) => read.key);
  uniqueKeys(versionKeys, 'receipt.versions');
  return receipt;
}

/** Checks that the snapshot's records agree with each other, and remembers a frozen snapshot that passed. */
function checkRecords(snapshot: Snapshot): void {
  const recordKeys = snapshot.records.map((record) => record.key);
  uniqueKeys(recordKeys, 'records');
  snapshot.records.forEach((record) => checkTombstone(record));
  snapshot.records.forEach((record) => checkPayloadRevision(record));
  if (Object.isFrozen(snapshot)) checkedSnapshots.add(snapshot);
}

/** Rejects a tombstone that still holds a value or resources. History keeps the old references instead. */
function checkTombstone(record: StoredRecord): void {
  if (!record.deleted) return;
  if (record.value !== null || record.resources.length > 0)
    reject('corrupt-record', 'records', 'Malformed tombstone');
}

/** Checks the header of a live versioned document. Other records are not inspected. */
function checkPayloadRevision(record: StoredRecord): void {
  if (record.deleted) return;
  if (!isVersionedDocument(record.key.kind)) return;
  checkDocumentHeader(record);
}

/**
 * Rejects a versioned document whose payload `id` or `revision` differs from its record key and version.
 * The shape check alone cannot catch this, because it looks at the payload and the record separately.
 */
function checkDocumentHeader(record: StoredRecord): void {
  const data = record.value;
  if (data === null || typeof data !== 'object')
    reject('corrupt-record', 'records', 'Versioned payload is not an object');

  const fields = Object.fromEntries(Object.entries(data));
  const idMatches = fields.id === record.key.id;
  const revisionMatches = fields.revision === record.version;
  if (!idMatches || !revisionMatches)
    reject('corrupt-record', 'records', 'Versioned payload header differs from its slot');
}

/**
 * Parses a snapshot's shape. Frozen input is parsed record by record and the result is cached,
 * so records that have not changed since the last commit are not parsed again.
 */
function readEnvelope(input: unknown): Snapshot {
  if (!isFrozenObject(input)) return readWholeSnapshot(input);

  const known = envelopes.get(input);
  if (known !== undefined) return known;
  return readFrozenEnvelope(input);
}

/** Parses a frozen snapshot record by record and caches the result. Falls back to a whole parse when `records` is not an array. */
function readFrozenEnvelope(input: object): Snapshot {
  const fields: Record<string, unknown> = { ...input };
  if (!Array.isArray(fields.records)) return readWholeSnapshot(input);

  const records = fields.records.map((record) =>
    readShape(storedSchema, record, 'corrupt-record', storedLimits),
  );
  const head = readShape(
    snapshotSchema,
    { ...fields, records: [] },
    'corrupt-record',
    storedLimits,
  );
  const snapshot = freeze({ ...head, records });
  envelopes.set(input, snapshot);
  return snapshot;
}

/** Parses a whole snapshot in one pass. */
function readWholeSnapshot(input: unknown): Snapshot {
  return readShape(snapshotSchema, input, 'corrupt-record', storedLimits);
}
