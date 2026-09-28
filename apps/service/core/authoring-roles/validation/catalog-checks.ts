/*
 * The candidate checks after the collections: every preset record, the workspace metadata, the
 * catalog record and every asset-admission record, each against its retained bytes. Pure over
 * Assets; every check answers `invariant-violation` at `candidate` as a value (record-checks.ts),
 * and the first failure stops validation. Authoring keeps the committed snapshot on rejection.
 */
import type {
  Assets,
  AuthoringResult,
  Preset,
  Snapshot,
  StoredRecord,
} from '../../../contract/records/capability-types.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { workspaceMetadata, assetMetadata } from '../../../contract/records/workspace/metadata.js';
import { andThen } from '../../../contract/errors.js';
import { presetResources } from '../../presets/resources.js';
import {
  assetRecordId,
  liveRecords,
  METADATA_RECORD_ID,
  presetRecordId,
} from '../../workspace/records.js';
import {
  allPassed,
  invariantBroken,
  requireFact,
  requireRecord,
  requireRetention,
} from './record-checks.js';

/** What the catalog checks read: Assets resolves retained digests. */
export interface CatalogCheckOwners {
  readonly assets: Pick<Assets, 'resolve'>;
}

/**
 * Checks each preset in order: its record at `preset:<digest>` retains exactly its fonts or
 * assets, and Assets resolves each of those digests. Fails with `invariant-violation` at
 * `candidate` when the record is missing, the resources differ or bytes are missing.
 */
export function checkPresets(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CatalogCheckOwners,
): AuthoringResult<void> {
  return allPassed(view.presets, (preset) => checkPreset(snapshot, preset, owners));
}

/**
 * Checks the workspace metadata, then the catalog, then every asset-admission record. Fails with
 * `invariant-violation` at `candidate` as `checkWorkspaceRecord`, `checkCatalogRecord` or
 * `checkAsset` fails.
 */
export function checkMetadata(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CatalogCheckOwners,
): AuthoringResult<void> {
  const workspace = checkWorkspaceRecord(snapshot);
  const catalog = andThen(workspace, () => checkCatalogRecord(snapshot, view));
  return andThen(catalog, () => checkAssets(snapshot, owners));
}

/**
 * One preset's record retains exactly its digests, and each digest resolves. Fails with
 * `invariant-violation` at `candidate` ("Missing preset bytes <digest>" for bytes Assets cannot
 * resolve).
 */
function checkPreset(
  snapshot: Snapshot,
  preset: Preset,
  owners: CatalogCheckOwners,
): AuthoringResult<void> {
  const slot = requireRecord(snapshot, 'preset', presetRecordId(preset.digest));
  if (!slot.ok) return slot;
  const expected = presetResources(preset);
  const retained = requireRetention(slot.value, expected);
  return andThen(retained, () => checkPresetBytes(expected, owners));
}

/**
 * Assets resolves each preset digest, in order. Fails with `invariant-violation` at `candidate`
 * ("Missing preset bytes <digest>") at the first digest it cannot resolve; later digests are not
 * read.
 */
function checkPresetBytes(
  digests: readonly string[],
  owners: CatalogCheckOwners,
): AuthoringResult<void> {
  return allPassed(digests, (digest) =>
    requireFact(owners.assets.resolve(digest).ok, `Missing preset bytes ${digest}`),
  );
}

/**
 * The workspace metadata record: present, valid, naming this workspace and retaining no bytes.
 * Fails with `invariant-violation` at `candidate` ("Invalid workspace metadata", "Workspace
 * metadata identity differs", or as `requireRecord` / `requireRetention` fail).
 */
function checkWorkspaceRecord(snapshot: Snapshot): AuthoringResult<void> {
  const slot = requireRecord(snapshot, 'workspace', METADATA_RECORD_ID);
  if (!slot.ok) return slot;
  const metadata = workspaceMetadata.safeParse(slot.value.value);
  if (!metadata.success) return invariantBroken('Invalid workspace metadata');
  const identity = requireFact(
    metadata.data.id === snapshot.workspace,
    'Workspace metadata identity differs',
  );
  return andThen(identity, () => requireRetention(slot.value, []));
}

/**
 * The catalog record: present at the catalog's revision and retaining no bytes. Fails with
 * `invariant-violation` at `candidate` ("Catalog revision differs", or as `requireRecord` /
 * `requireRetention` fail).
 */
function checkCatalogRecord(
  snapshot: Snapshot,
  view: WorkspaceContents,
): AuthoringResult<void> {
  const organisation = view.library.organisation;
  const catalog = requireRecord(snapshot, 'catalog', organisation.id);
  if (!catalog.ok) return catalog;
  const revision = requireFact(
    catalog.value.version === organisation.revision,
    'Catalog revision differs',
  );
  return andThen(revision, () => requireRetention(catalog.value, []));
}

/**
 * Checks each asset-admission record in order (see `checkAsset`); the first failure stops the
 * checks.
 */
function checkAssets(
  snapshot: Snapshot,
  owners: CatalogCheckOwners,
): AuthoringResult<void> {
  return allPassed(liveRecords(snapshot, 'asset-admission'), (record) =>
    checkAsset(record, owners),
  );
}

/**
 * One asset-admission record: valid metadata, stored at `asset:<digest>`, retaining only that
 * digest, and its bytes resolvable in Assets. Fails with `invariant-violation` at `candidate`
 * when any of these fails.
 */
function checkAsset(
  record: StoredRecord,
  owners: CatalogCheckOwners,
): AuthoringResult<void> {
  const parsed = assetMetadata.safeParse(record.value);
  if (!parsed.success) return invariantBroken('Invalid asset discovery metadata');
  const digest = parsed.data.digest;
  const identity = requireFact(
    record.key.id === assetRecordId(digest),
    'Asset discovery identity differs from its digest',
  );
  const retained = andThen(identity, () => requireRetention(record, [digest]));
  return andThen(retained, () =>
    requireFact(owners.assets.resolve(digest).ok, `Missing admitted asset ${digest}`),
  );
}
