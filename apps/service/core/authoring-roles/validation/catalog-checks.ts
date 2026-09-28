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
import { success } from '../../../contract/errors.js';
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
  if (!workspace.ok) {
    return workspace;
  }
  const catalog = checkCatalogRecord(snapshot, contents);
  if (!catalog.ok) {
    return catalog;
  }
  return checkAssets(snapshot, dependencies);
}

/** Checks one preset's record keeps exactly the preset's files, and each file can be read. */
function checkPreset(
  snapshot: Snapshot,
  preset: Preset,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  const recordId = presetRecordId(preset.digest);
  const record = requireRecord(snapshot, 'preset', recordId);
  if (!record.ok) {
    return record;
  }
  const fileDigests = listPresetFileDigests(preset);
  const retained = requireExactFiles(record.value, fileDigests);
  if (!retained.ok) {
    return retained;
  }
  return checkEach(fileDigests, (digest) => requirePresetFile(digest, dependencies));
}

/** Checks Assets can read one of a preset's files. */
function requirePresetFile(
  digest: string,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  const stored = dependencies.assets.resolve(digest);
  if (!stored.ok) {
    return missingPresetFileFailure(digest);
  }
  return success(undefined);
}

/** Checks the workspace's details record is valid, names this workspace, and keeps no files. */
function checkWorkspaceRecord(snapshot: Snapshot): AuthoringResult<void> {
  const record = requireRecord(snapshot, 'workspace', METADATA_RECORD_ID);
  if (!record.ok) {
    return record;
  }
  const named = requireThisWorkspace(record.value, snapshot);
  if (!named.ok) {
    return named;
  }
  return requireExactFiles(record.value, []);
}

/** Checks the details record is valid and names the workspace being saved. */
function requireThisWorkspace(
  record: StoredRecord,
  snapshot: Snapshot,
): AuthoringResult<void> {
  const metadata = workspaceMetadata.safeParse(record.value);
  if (!metadata.success) {
    return invalidWorkspaceMetadataFailure();
  }
  if (metadata.data.id !== snapshot.workspace) {
    return otherWorkspaceFailure();
  }
  return success(undefined);
}

/** Checks the catalog record is at the catalog's revision and keeps no files. */
function checkCatalogRecord(
  snapshot: Snapshot,
  contents: WorkspaceContents,
): AuthoringResult<void> {
  const organisation = contents.library.organisation;
  const record = requireRecord(snapshot, 'catalog', organisation.id);
  if (!record.ok) {
    return record;
  }
  if (record.value.version !== organisation.revision) {
    return catalogRevisionFailure();
  }
  return requireExactFiles(record.value, []);
}

/** Checks each uploaded file's description in order; the first mistake stops the checks. */
function checkAssets(
  snapshot: Snapshot,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  const assetRecords = listLiveRecords(snapshot, 'asset-admission');
  return checkEach(assetRecords, (record) => checkAsset(record, dependencies));
}

/** Checks one uploaded file's description, that it keeps only its own file, and the file can be read. */
function checkAsset(
  record: StoredRecord,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  const digest = readAssetDigest(record);
  if (!digest.ok) {
    return digest;
  }
  const retained = requireExactFiles(record, [digest.value]);
  if (!retained.ok) {
    return retained;
  }
  return requireUploadedFile(digest.value, dependencies);
}

/** Reads the file's digest from its description, and checks the record is stored under it. */
function readAssetDigest(record: StoredRecord): AuthoringResult<string> {
  const metadata = assetMetadata.safeParse(record.value);
  if (!metadata.success) {
    return invalidAssetMetadataFailure();
  }
  const digest = metadata.data.digest;
  if (record.key.id !== assetRecordId(digest)) {
    return assetIdentityFailure();
  }
  return success(digest);
}

/** Checks Assets can read an uploaded file. */
function requireUploadedFile(
  digest: string,
  dependencies: CatalogCheckDependencies,
): AuthoringResult<void> {
  const stored = dependencies.assets.resolve(digest);
  if (!stored.ok) {
    return missingUploadedFileFailure(digest);
  }
  return success(undefined);
}

/** Makes the mistake for a preset file Assets can't read. */
function missingPresetFileFailure(digest: string): AuthoringResult<never> {
  return invariantViolationFailure(`Missing preset bytes ${digest}`);
}

/** Makes the mistake for a details record that isn't valid. */
function invalidWorkspaceMetadataFailure(): AuthoringResult<never> {
  return invariantViolationFailure('Invalid workspace metadata');
}

/** Makes the mistake for a details record that names another workspace. */
function otherWorkspaceFailure(): AuthoringResult<never> {
  return invariantViolationFailure('Workspace metadata identity differs');
}

/** Makes the mistake for a catalog record that isn't at the catalog's revision. */
function catalogRevisionFailure(): AuthoringResult<never> {
  return invariantViolationFailure('Catalog revision differs');
}

/** Makes the mistake for an uploaded file's description that isn't valid. */
function invalidAssetMetadataFailure(): AuthoringResult<never> {
  return invariantViolationFailure('Invalid asset discovery metadata');
}

/** Makes the mistake for an uploaded file's description stored under another digest. */
function assetIdentityFailure(): AuthoringResult<never> {
  return invariantViolationFailure('Asset discovery identity differs from its digest');
}

/** Makes the mistake for an uploaded file Assets can't read. */
function missingUploadedFileFailure(digest: string): AuthoringResult<never> {
  return invariantViolationFailure(`Missing admitted asset ${digest}`);
}
