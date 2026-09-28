/*
 * Live-record lookup over one Authoring snapshot, and the record IDs the service stores under.
 * A deleted record is never live. Pure and total: absence is `undefined` or an empty list, never
 * a failure, so each caller names its own refusal. Authoring owns the records, commit and
 * recovery.
 */
import type {
  Preset,
  RecordKey,
  Snapshot,
  StoredRecord,
} from '../../contract/records/capability-types.js';
import type { AssetDigest } from '../../contract/brands.js';

/** A record kind Authoring stores. */
export type RecordKind = RecordKey['kind'];

/** The ID of the workspace metadata record (kind `workspace`). */
export const METADATA_RECORD_ID = 'metadata';

/** The ID of the catalog record a new workspace starts with (kind `catalog`). */
export const MAIN_CATALOG_ID = 'main';

/**
 * The live record with this kind and ID, or `undefined` when none is stored or it is deleted.
 * Never fails.
 */
export function liveRecord(
  snapshot: Snapshot,
  kind: RecordKind,
  id: string,
): StoredRecord | undefined {
  return snapshot.records.find(
    (item) => !item.deleted && item.key.kind === kind && item.key.id === id,
  );
}

/** Every live record of this kind, in snapshot order. Never fails. */
export function liveRecords(
  snapshot: Snapshot,
  kind: RecordKind,
): readonly StoredRecord[] {
  return snapshot.records.filter((item) => !item.deleted && item.key.kind === kind);
}

/** The ID of a preset record (kind `preset`): `preset:<digest>`. Never fails. */
export function presetRecordId(digest: Preset['digest']): `preset:${string}` {
  return `preset:${digest}`;
}

/** The ID of an asset-admission record (kind `asset-admission`): `asset:<digest>`. Never fails. */
export function assetRecordId(digest: AssetDigest): `asset:${string}` {
  return `asset:${digest}`;
}
