/*
 * Why this file exists
 *
 * While a change is planned and saved, no file the workspace uses may be cleaned away, and the
 * stored presets must not change unnoticed. For example, a DSL change that shows a logo needs the
 * logo's file kept until Authoring has saved the change.
 *
 * This file lists both: the digests of the files Authoring should hold, and every stored preset
 * record with its version. It only reads the snapshot.
 */
import type {
  AuthoringResult,
  Catalog,
  ReadVersion,
  Request,
  Snapshot,
  StoredRecord,
} from '../../../contract/records/capability-types.js';
import { removeDigestPrefix, type AuthoringDigest } from '../../../contract/brands.js';
import { collect, success } from '../../../contract/errors.js';
import type { AssetBinding } from '../../presets/theme-binding.js';
import type { AssetBindings } from './asset-bindings.js';
import { checkDigest, checkDigests } from './digests.js';
import { listThemePresets } from './themes.js';

/**
 * Lists the digests of the files to hold until the change is saved: every file the workspace's
 * records and themes use, plus this change's uploads and newly bound files. Each is listed once.
 * Fails with `invalid-input` at `resources` when a digest is malformed.
 */
export function listDigestsToHold(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
  boundAssets: AssetBindings,
): AuthoringResult<readonly AuthoringDigest[]> {
  const usedDigests = listUsedDigests(request, snapshot, catalog);
  const held = checkDigests(usedDigests);
  if (!held.ok) {
    return held;
  }
  const bound = checkBoundDigests(boundAssets);
  if (!bound.ok) {
    return bound;
  }
  const digests = joinEachOnce(held.value, bound.value);
  return success(digests);
}

/**
 * Lists every stored preset record, deleted ones too, with the version read. Authoring refuses the
 * change if one of them moves before it is saved. Never fails.
 */
export function listPresetReads(snapshot: Snapshot): readonly ReadVersion[] {
  const presetRecords = snapshot.records.filter(isPresetRecord);
  return presetRecords.map((record) => ({ key: record.key, version: record.version }));
}

/** Lists the bare digests of the stored records' files, this change's uploads and theme fonts. */
function listUsedDigests(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
): readonly string[] {
  const recordFiles = snapshot.records.flatMap((record) => record.resources);
  const uploads = request.assets.map((upload) => upload.digest);
  const themeFonts = listThemePresets(catalog).flatMap((theme) => theme.payload.fonts);
  return [...recordFiles, ...uploads, ...themeFonts];
}

/** Checks the digest of each file binding, in order, with its `sha256:` prefix taken off. */
function checkBoundDigests(
  boundAssets: AssetBindings,
): AuthoringResult<readonly AuthoringDigest[]> {
  const bindings = Object.values(boundAssets);
  return collect(bindings, checkBoundDigest);
}

/** Checks one file binding's digest, with its `sha256:` prefix taken off. */
function checkBoundDigest(binding: AssetBinding): AuthoringResult<AuthoringDigest> {
  const bareDigest = removeDigestPrefix(binding.digest);
  return checkDigest(bareDigest);
}

/** Joins two digest lists, keeping each digest once, in the order first seen. */
function joinEachOnce(
  first: readonly AuthoringDigest[],
  second: readonly AuthoringDigest[],
): readonly AuthoringDigest[] {
  const distinctDigests = new Set([...first, ...second]);
  return [...distinctDigests];
}

/** Whether a stored record is a preset. */
function isPresetRecord(record: StoredRecord): boolean {
  return record.key.kind === 'preset';
}
