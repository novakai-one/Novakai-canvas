/*
 * Why this file exists
 *
 * After the collections, the final check looks at every other kind of record. Each must exist, be
 * valid, and keep exactly the stored files it should, and those files must really be there. For
 * example, a theme's record must keep exactly its font files, and each font must be readable.
 *
 * This file checks the presets, then the workspace's details, the catalog and each uploaded file's
 * description. Each check answers a `Result` (contract/errors.ts), and the first mistake stops it.
 * Every mistake is `invariant-violation` at `candidate`, made in record-checks.ts. It only reads.
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
import { listPresetFileDigests } from '../../presets/resources.js';
import {
  assetRecordId,
  listLiveRecords,
  METADATA_RECORD_ID,
  presetRecordId,
} from '../../workspace/records.js';
import {
  checkEach,
  invariantViolationFailure,
  requireFact,
  requireRecord,
  requireExactFiles,
} from './record-checks.js';

/** What these checks need: Assets, to confirm each stored file can be read. */
export interface CatalogCheckDependencies {
  /** The file store. `resolve` reads a stored file by its digest. */
  readonly assets: Pick<Assets, 'resolve'>;
}

/**
 * Checks each preset, in order. Its record must exist and keep exactly the files it uses (a
 * theme's fonts, a recipe's stored files), and each of those files must be readable. The first
 * mistake stops the checks.
 */
export function checkPresets(
  snapshot: Snapshot,
  contents: WorkspaceContents,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  return checkEach(contents.presets, (preset) => checkPreset(snapshot, preset, dependencies));
}

/**
 * Checks the workspace's details record, then the catalog record, then each uploaded file's
 * description. The details must name this workspace, the catalog must be at its current revision,
 * and each uploaded file must be readable. The first mistake stops the checks.
 */
export function checkMetadataRecords(
  snapshot: Snapshot,
  contents: WorkspaceContents,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  const workspace = checkWorkspaceRecord(snapshot);
  const catalog = andThen(workspace, () => checkCatalogRecord(snapshot, contents));
  return andThen(catalog, () => checkAssets(snapshot, dependencies));
}

/**
 * One preset's record retains exactly its digests, and each digest resolves. Fails with
 * `invariant-violation` at `candidate` ("Missing preset bytes <digest>" for bytes Assets cannot
 * resolve).
 */
function checkPreset(
  snapshot: Snapshot,
  preset: Preset,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  const slot = requireRecord(snapshot, 'preset', presetRecordId(preset.digest));
  if (!slot.ok) return slot;
  const expected = listPresetFileDigests(preset);
  const retained = requireExactFiles(slot.value, expected);
  return andThen(retained, () => checkPresetBytes(expected, dependencies));
}

/**
 * Assets resolves each preset digest, in order. Fails with `invariant-violation` at `candidate`
 * ("Missing preset bytes <digest>") at the first digest it cannot resolve; later digests are not
 * read.
 */
function checkPresetBytes(
  digests: readonly string[],
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  return checkEach(digests, (digest) =>
    requireFact(dependencies.assets.resolve(digest).ok, `Missing preset bytes ${digest}`),
  );
}

/**
 * The workspace metadata record: present, valid, naming this workspace and retaining no bytes.
 * Fails with `invariant-violation` at `candidate` ("Invalid workspace metadata", "Workspace
 * metadata identity differs", or as `requireRecord` / `requireExactFiles` fail).
 */
function checkWorkspaceRecord(snapshot: Snapshot): AuthoringResult<void> {
  const slot = requireRecord(snapshot, 'workspace', METADATA_RECORD_ID);
  if (!slot.ok) return slot;
  const metadata = workspaceMetadata.safeParse(slot.value.value);
  if (!metadata.success) return invariantViolationFailure('Invalid workspace metadata');
  const identity = requireFact(
    metadata.data.id === snapshot.workspace,
    'Workspace metadata identity differs',
  );
  return andThen(identity, () => requireExactFiles(slot.value, []));
}

/**
 * The catalog record: present at the catalog's revision and retaining no bytes. Fails with
 * `invariant-violation` at `candidate` ("Catalog revision differs", or as `requireRecord` /
 * `requireExactFiles` fail).
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
  return andThen(revision, () => requireExactFiles(catalog.value, []));
}

/**
 * Checks each asset-admission record in order (see `checkAsset`); the first failure stops the
 * checks.
 */
function checkAssets(
  snapshot: Snapshot,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  return checkEach(listLiveRecords(snapshot, 'asset-admission'), (record) =>
    checkAsset(record, dependencies),
  );
}

/**
 * One asset-admission record: valid metadata, stored at `asset:<digest>`, retaining only that
 * digest, and its bytes resolvable in Assets. Fails with `invariant-violation` at `candidate`
 * when any of these fails.
 */
function checkAsset(
  record: StoredRecord,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  const parsed = assetMetadata.safeParse(record.value);
  if (!parsed.success) return invariantViolationFailure('Invalid asset discovery metadata');
  const digest = parsed.data.digest;
  const identity = requireFact(
    record.key.id === assetRecordId(digest),
    'Asset discovery identity differs from its digest',
  );
  const retained = andThen(identity, () => requireExactFiles(record, [digest]));
  return andThen(retained, () =>
    requireFact(dependencies.assets.resolve(digest).ok, `Missing admitted asset ${digest}`),
  );
}
