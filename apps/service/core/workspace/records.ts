/*
 * Why this file exists
 *
 * Authoring keeps a workspace as records, each with a kind and an ID. A deleted record stays in the
 * snapshot, marked `deleted`, so most service code wants only the records that still exist ("live"
 * records). For example, `listLiveRecords(snapshot, 'collection')` answers every saved collection.
 *
 * This file finds live records, and makes the record IDs the service saves under (`metadata`,
 * `main`, `preset:<digest>`, `asset:<digest>`). It never fails: nothing found is `undefined` or an
 * empty list, and each caller decides what that means.
 */
import type { RecordKey, Snapshot, StoredRecord } from '../../contract/records/capability-types.js';
import type { AssetDigest, PresetDigest } from '../../contract/brands.js';

/**
 * One of the record kinds Authoring stores: `collection`, `catalog`, `asset-admission`, `preset`,
 * `workspace` or `history`.
 */
export type RecordKind = RecordKey['kind'];

/** The ID of the record that holds the workspace's details (kind `workspace`). */
export const METADATA_RECORD_ID = 'metadata';

/** The ID of the catalog record a new workspace starts with (kind `catalog`). */
export const MAIN_CATALOG_ID = 'main';

/**
 * Finds the live record with this kind and ID, or `undefined` when there is none. `id` is the
 * record ID as plain text, compared as it is. Never fails.
 */
export function findLiveRecord(
  snapshot: Snapshot,
  kind: RecordKind,
  id: string,
): StoredRecord | undefined {
  return snapshot.records.find(
    (item) => !item.deleted && item.key.kind === kind && item.key.id === id,
  );
}

/** Lists every live record of this kind, in snapshot order. Never fails. */
export function listLiveRecords(
  snapshot: Snapshot,
  kind: RecordKind,
): readonly StoredRecord[] {
  return snapshot.records.filter((item) => !item.deleted && item.key.kind === kind);
}

/** Makes the ID a preset is saved under (kind `preset`): `preset:<digest>`. Never fails. */
export function presetRecordId(digest: PresetDigest): `preset:${string}` {
  return `preset:${digest}`;
}

/**
 * Makes the ID an uploaded file's stored description is saved under (kind `asset-admission`):
 * `asset:<digest>`. Never fails.
 */
export function assetRecordId(digest: AssetDigest): `asset:${string}` {
  return `asset:${digest}`;
}
