/*
 * Why this file exists
 *
 * A collection records the exact theme version it uses, and each image's digest and media type.
 * Before it is saved, rendered or exported, those must still match what is stored. For example,
 * if a logo's stored bytes are a PNG but the collection says SVG, the check stops with
 * `missing-asset`.
 *
 * This file does that check, and lists the digests of the theme's fonts and the images, so the
 * caller can hold those files. Each step answers a `Result` (contract/errors.ts), and the first
 * mistake stops the check. It only reads.
 */
import type {
  Assets,
  AuthoringResult,
  Collection,
  LoweredIntent,
  Templates,
  ThemePreset,
} from '../../../contract/records/capability-types.js';
import { removeDigestPrefix, type AuthoringDigest } from '../../../contract/brands.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import type { AssetBinding } from '../../presets/theme-binding.js';
import { checkDigests } from './digests.js';
import { fromCapability, missingAssetFailure } from './refusal.js';

/** What the check needs. */
export interface CollectionCheckDependencies {
  /** Templates, which finds the exact theme version the collection records. */
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
  /** The file store, which says whether each image is stored and what its media type is. */
  readonly assets: Pick<Assets, 'resolve'>;
}

/**
 * Checks that a collection's theme and images still match what is stored, and lists the digests
 * of the theme's fonts and the images, sorted. Fails with `missing-asset` at `resources` when the
 * theme or an image is missing or differs (a capability's failure kept as `source`), or
 * `invalid-input` at `resources` when a digest is malformed.
 */
export function checkCollectionFiles(
  collection: Collection,
  contents: WorkspaceContents,
  dependencies: CollectionCheckDependencies,
): AuthoringResult<readonly AuthoringDigest[]> {
  const theme = pinnedTheme(collection, contents, dependencies);
  if (!theme.ok) return theme;
  const checked = checkBindings(collection, theme.value, dependencies);
  if (!checked.ok) return checked;
  return checkDigests([
    ...theme.value.payload.fonts,
    ...collection.assets.map((item) => removeDigestPrefix(item.digest)),
  ]);
}

/**
 * The stored theme the collection pins. Fails with `missing-asset` at `resources` when Templates
 * refuses the pin (its failure kept in `source`), or ("Collection pin does not identify a theme")
 * when the pinned preset is not a theme.
 */
function pinnedTheme(
  collection: Collection,
  view: WorkspaceContents,
  dependencies: CollectionCheckDependencies,
): AuthoringResult<ThemePreset> {
  const preset = fromCapability(
    dependencies.templates.read(view.presets, {
      kind: 'theme',
      id: collection.theme.id,
      version: collection.theme.version,
      digest: removeDigestPrefix(collection.theme.digest),
    }),
  );
  if (!preset.ok) return preset;
  if (preset.value.kind !== 'theme')
    return missingAssetFailure('Collection pin does not identify a theme');
  return success(preset.value);
}

/** The theme roles, then every asset's media type (see `checkRoles`, `checkMediaTypes`). */
function checkBindings(
  collection: Collection,
  theme: ThemePreset,
  dependencies: CollectionCheckDependencies,
): AuthoringResult<void> {
  const roles = checkRoles(collection.theme.roles, theme.payload.roles);
  return andThen(roles, () => checkMediaTypes(collection.assets, dependencies));
}

/**
 * The collection's theme roles must equal the pinned preset's roles, in any order. Fails with
 * `missing-asset` at `resources` ("Collection theme roles differ from the pinned preset") when
 * they differ.
 */
function checkRoles(
  pinned: readonly string[],
  preset: readonly string[],
): AuthoringResult<void> {
  if (!sameRoles(pinned, preset))
    return missingAssetFailure('Collection theme roles differ from the pinned preset');
  return success(undefined);
}

/** Whether both role lists hold the same roles, each as often, in any order. */
function sameRoles(
  pinned: readonly string[],
  preset: readonly string[],
): boolean {
  const left = pinned.toSorted();
  const right = preset.toSorted();
  return left.length === right.length && left.every((role, index) => role === right[index]);
}

/**
 * Each asset's stored bytes must still have the media type the collection records, checked in
 * collection order. Fails with the first asset's failure (see `checkMediaType`); later assets are
 * not read.
 */
function checkMediaTypes(
  bindings: readonly AssetBinding[],
  dependencies: CollectionCheckDependencies,
): AuthoringResult<void> {
  const checked = collect(bindings, (binding) => checkMediaType(binding, dependencies));
  return andThen(checked, () => success(undefined));
}

/**
 * One asset's stored bytes must have the media type it records. Fails with `missing-asset` at
 * `resources` when Assets refuses the digest (its failure kept in `source`), or ("Asset media type
 * differs: <id>") when the media type differs.
 */
function checkMediaType(
  binding: AssetBinding,
  dependencies: CollectionCheckDependencies,
): AuthoringResult<void> {
  const blob = fromCapability(dependencies.assets.resolve(removeDigestPrefix(binding.digest)));
  if (!blob.ok) return blob;
  if (blob.value.descriptor.mediaType !== binding.mediaType)
    return missingAssetFailure(`Asset media type differs: ${binding.id}`);
  return success(undefined);
}
