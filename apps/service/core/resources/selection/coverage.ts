/*
 * Why this file exists
 *
 * While a change is planned and saved, its files must not be cleaned away, and the stored presets
 * it used must not change unnoticed. For example, a DSL change that shows a logo needs the logo's
 * file kept until Authoring has saved the change.
 *
 * This file lists both for one pick: the digests of the files Authoring should hold, and the
 * stored preset records read, with their versions. It only reads the snapshot.
 */
import type {
  AuthoringResult,
  Catalog,
  ReadVersion,
  Request,
  ResolvedResources,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import { removeDigestPrefix, type AuthoringDigest } from '../../../contract/brands.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import { checkDigest, checkDigests } from './digests.js';
import { listThemePresets } from './themes.js';

/**
 * Lists the digests of the files to hold until the change is saved. First the files the stored
 * records, the uploads and the themes' fonts use (sorted, each once), then each newly bound file.
 * Fails with `invalid-input` at `resources` when a digest is malformed.
 */
export function listFileDigests(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
  boundAssets: ResolvedResources['assets'],
): AuthoringResult<readonly AuthoringDigest[]> {
  const held = checkDigests([
    ...snapshot.records.flatMap((item) => item.resources),
    ...request.assets.map((item) => item.digest),
    ...listThemePresets(catalog).flatMap((item) => item.payload.fonts),
  ]);
  if (!held.ok) return held;
  const bytes = collect(Object.values(boundAssets), (binding) =>
    checkDigest(removeDigestPrefix(binding.digest)),
  );
  return andThen(bytes, (added) => success([...new Set([...held.value, ...added])]));
}

/**
 * Lists every stored preset record, deleted ones too, with the version read. Authoring refuses the
 * change if one of them moves before it is saved. Never fails.
 */
export function listPresetReads(snapshot: Snapshot): readonly ReadVersion[] {
  return snapshot.records
    .filter((item) => item.key.kind === 'preset')
    .map((item) => ({ key: item.key, version: item.version }));
}
