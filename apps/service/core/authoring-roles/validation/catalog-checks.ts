/*
 * The candidate checks after the collections: every preset record, the workspace metadata, the
 * catalog record and every asset-admission record, each against its retained bytes. Pure over
 * Assets; a failed check throws `AdmissionFault`, which only `validate` (candidate.ts) catches.
 * Authoring keeps the committed snapshot on rejection.
 */
import type { Assets, Snapshot, StoredRecord } from '../../../contract/records/capabilities.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { workspaceMetadata, assetMetadata } from '../../../contract/records/workspace/metadata.js';
import { presetResources } from '../../presets/resources.js';
import {
  assetRecordId,
  liveRecords,
  METADATA_RECORD_ID,
  presetRecordId,
} from '../../workspace/records.js';
import { AdmissionFault, requireFact, requireRecord, requireRetention } from './admission-fault.js';

/** What the catalog checks read: Assets resolves retained digests. */
export interface CatalogCheckOwners {
  readonly assets: Pick<Assets, 'resolve'>;
}

/**
 * Checks each preset: its record at `preset:<digest>` retains exactly its fonts or assets, and
 * Assets resolves each of those digests. Throws `AdmissionFault` when the record is missing, the
 * resources differ or bytes are missing.
 */
export function checkPresets(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CatalogCheckOwners,
): void {
  view.presets.forEach((preset) => {
    const slot = requireRecord(snapshot, 'preset', presetRecordId(preset.digest));
    const expected = presetResources(preset);
    requireRetention(slot, expected);
    expected.forEach((digest) =>
      requireFact(owners.assets.resolve(digest).ok, `Missing preset bytes ${digest}`),
    );
  });
}

/**
 * Checks the workspace metadata, the catalog and every asset-admission record. Throws
 * `AdmissionFault` when metadata is missing, invalid or names another workspace; when the
 * catalog record is missing or at another revision; when either retains resources; or when an
 * asset-admission record fails (see `asset`).
 */
export function checkMetadata(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CatalogCheckOwners,
): void {
  const slot = requireRecord(snapshot, 'workspace', METADATA_RECORD_ID);
  const parsed = workspaceMetadata.safeParse(slot.value);
  if (!parsed.success) throw new AdmissionFault('Invalid workspace metadata');
  requireFact(parsed.data.id === snapshot.workspace, 'Workspace metadata identity differs');
  requireRetention(slot, []);
  const catalog = requireRecord(snapshot, 'catalog', view.library.organisation.id);
  requireFact(catalog.version === view.library.organisation.revision, 'Catalog revision differs');
  requireRetention(catalog, []);
  liveRecords(snapshot, 'asset-admission').forEach((item) => asset(item, owners));
}

/**
 * Checks one asset-admission record: valid metadata, stored at `asset:<digest>`, retaining only
 * that digest, and its bytes resolvable in Assets. Throws `AdmissionFault` when any of these fails.
 */
function asset(
  record: StoredRecord,
  owners: CatalogCheckOwners,
): void {
  const parsed = assetMetadata.safeParse(record.value);
  if (!parsed.success) throw new AdmissionFault('Invalid asset discovery metadata');
  requireFact(
    record.key.id === assetRecordId(parsed.data.digest),
    'Asset discovery identity differs from its digest',
  );
  requireRetention(record, [parsed.data.digest]);
  requireFact(
    owners.assets.resolve(parsed.data.digest).ok,
    `Missing admitted asset ${parsed.data.digest}`,
  );
}
