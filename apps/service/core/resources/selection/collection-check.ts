/*
 * Whether a committed collection's pins still match the stored presets and bytes, and which bytes
 * it needs. Pure over Templates and Assets; a mismatch is `missing-asset` and a malformed digest
 * `invalid-input`, both at `resources` (refusal.ts). Authoring owns recovery.
 */
import type {
  Assets,
  AuthoringResult,
  Collection,
  LoweredIntent,
  Templates,
  ThemePreset,
} from '../../../contract/records/capabilities.js';
import { bareDigest, type AuthoringDigest } from '../../../contract/brands.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import type { AssetBinding } from '../../presets/theme-binding.js';
import { sortedDigests } from './digests.js';
import { fromOwner, resourceRefused } from './refusal.js';

/** The owners the check reads: Templates for the pinned theme, Assets for the stored bytes. */
export interface CollectionOwners {
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
  readonly assets: Pick<Assets, 'resolve'>;
}

/**
 * A collection's theme pin must name a stored theme; its fonts and asset bytes are returned
 * sorted.
 *
 * Steps; the first failure stops the check:
 * 1. Read the pinned theme through Templates (see `pinnedTheme`).
 * 2. Check the theme roles, then each asset's media type (see `checkBindings`).
 * 3. Check the font and asset digests.
 *
 * Fails with `missing-asset` at `resources` when Templates or Assets refuses a pin (owner failure
 * in `source`), when the pin is not a theme, or when the theme roles or an asset's media type
 * differ; `invalid-input` at `resources` when a font or asset digest is malformed.
 */
export function collectionResources(
  collection: Collection,
  view: WorkspaceContents,
  owners: CollectionOwners,
): AuthoringResult<readonly AuthoringDigest[]> {
  const theme = pinnedTheme(collection, view, owners);
  if (!theme.ok) return theme;
  const checked = checkBindings(collection, theme.value, owners);
  if (!checked.ok) return checked;
  return sortedDigests([
    ...theme.value.payload.fonts,
    ...collection.assets.map((item) => bareDigest(item.digest)),
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
  owners: CollectionOwners,
): AuthoringResult<ThemePreset> {
  const preset = fromOwner(
    owners.templates.read(view.presets, {
      kind: 'theme',
      id: collection.theme.id,
      version: collection.theme.version,
      digest: bareDigest(collection.theme.digest),
    }),
  );
  if (!preset.ok) return preset;
  if (preset.value.kind !== 'theme')
    return resourceRefused('Collection pin does not identify a theme');
  return success(preset.value);
}

/** The theme roles, then every asset's media type (see `checkRoles`, `checkMediaTypes`). */
function checkBindings(
  collection: Collection,
  theme: ThemePreset,
  owners: CollectionOwners,
): AuthoringResult<void> {
  const roles = checkRoles(collection.theme.roles, theme.payload.roles);
  return andThen(roles, () => checkMediaTypes(collection.assets, owners));
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
    return resourceRefused('Collection theme roles differ from the pinned preset');
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
 * Each asset's stored bytes must still have the media type the collection records. Fails with
 * the first asset's failure in collection order (see `checkMediaType`).
 */
function checkMediaTypes(
  bindings: readonly AssetBinding[],
  owners: CollectionOwners,
): AuthoringResult<void> {
  const checked = collect(bindings.map((item) => checkMediaType(item, owners)));
  return andThen(checked, () => success(undefined));
}

/**
 * One asset's stored bytes must have the media type it records. Fails with `missing-asset` at
 * `resources` when Assets refuses the digest (its failure kept in `source`), or ("Asset media type
 * differs: <id>") when the media type differs.
 */
function checkMediaType(
  binding: AssetBinding,
  owners: CollectionOwners,
): AuthoringResult<void> {
  const blob = fromOwner(owners.assets.resolve(bareDigest(binding.digest)));
  if (!blob.ok) return blob;
  if (blob.value.descriptor.mediaType !== binding.mediaType)
    return resourceRefused(`Asset media type differs: ${binding.id}`);
  return success(undefined);
}
