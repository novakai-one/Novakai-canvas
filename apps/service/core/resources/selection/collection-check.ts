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
import { collect, success } from '../../../contract/errors.js';
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
  if (!theme.ok) {
    return theme;
  }
  const checked = checkBindings(collection, theme.value, dependencies);
  if (!checked.ok) {
    return checked;
  }
  const fileDigests = listFileDigests(collection, theme.value);
  return checkDigests(fileDigests);
}

/** The exact theme version a collection records, as text; Templates checks it when it reads it. */
interface RecordedThemePin {
  readonly kind: 'theme';
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

/** Asks Templates for the exact theme version the collection records; it must be a theme. */
function pinnedTheme(
  collection: Collection,
  contents: WorkspaceContents,
  dependencies: CollectionCheckDependencies,
): AuthoringResult<ThemePreset> {
  const themePin = recordedThemePin(collection);
  const preset = fromCapability(dependencies.templates.read(contents.presets, themePin));
  if (!preset.ok) {
    return preset;
  }
  if (preset.value.kind !== 'theme') {
    return pinNotAThemeFailure();
  }
  return success(preset.value);
}

/** Writes the exact theme version the collection records as a pin Templates reads, digest bare. */
function recordedThemePin(collection: Collection): RecordedThemePin {
  return {
    kind: 'theme',
    id: collection.theme.id,
    version: collection.theme.version,
    digest: removeDigestPrefix(collection.theme.digest),
  };
}

/** Checks the theme roles first, then each image's media type. */
function checkBindings(
  collection: Collection,
  theme: ThemePreset,
  dependencies: CollectionCheckDependencies,
): AuthoringResult<void> {
  const roles = checkRoles(collection.theme.roles, theme.payload.roles);
  if (!roles.ok) {
    return roles;
  }
  return checkMediaTypes(collection.assets, dependencies);
}

/** Checks the collection records the same theme roles as the stored theme, in any order. */
function checkRoles(
  recorded: readonly string[],
  stored: readonly string[],
): AuthoringResult<void> {
  if (rolesDiffer(recorded, stored)) {
    return rolesDifferFailure();
  }
  return success(undefined);
}

/** Whether the two role lists differ, ignoring order but counting a repeated role each time. */
function rolesDiffer(
  recorded: readonly string[],
  stored: readonly string[],
): boolean {
  const recordedSorted = recorded.toSorted();
  const storedSorted = stored.toSorted();
  if (recordedSorted.length !== storedSorted.length) {
    return true;
  }
  return recordedSorted.some((role, index) => role !== storedSorted[index]);
}

/** Checks each image's media type in collection order, stopping at the first that differs. */
function checkMediaTypes(
  bindings: readonly AssetBinding[],
  dependencies: CollectionCheckDependencies,
): AuthoringResult<void> {
  const checked = collect(bindings, (binding) => checkMediaType(binding, dependencies));
  if (!checked.ok) {
    return checked;
  }
  return success(undefined);
}

/** Checks one image's stored bytes still have the media type the collection records. */
function checkMediaType(
  binding: AssetBinding,
  dependencies: CollectionCheckDependencies,
): AuthoringResult<void> {
  const bareDigest = removeDigestPrefix(binding.digest);
  const storedFile = fromCapability(dependencies.assets.resolve(bareDigest));
  if (!storedFile.ok) {
    return storedFile;
  }
  if (storedFile.value.descriptor.mediaType !== binding.mediaType) {
    return mediaTypeDiffersFailure(binding.id);
  }
  return success(undefined);
}

/** Lists the bare digests of the theme's fonts, then of the collection's images. */
function listFileDigests(
  collection: Collection,
  theme: ThemePreset,
): readonly string[] {
  const fontDigests = theme.payload.fonts;
  const imageDigests = collection.assets.map((binding) => removeDigestPrefix(binding.digest));
  return [...fontDigests, ...imageDigests];
}

/** Makes the mistake for a recorded theme pin that names a recipe: `missing-asset`. */
function pinNotAThemeFailure(): AuthoringResult<never> {
  return missingAssetFailure('Collection pin does not identify a theme');
}

/** Makes the mistake for theme roles that differ from the stored theme's: `missing-asset`. */
function rolesDifferFailure(): AuthoringResult<never> {
  return missingAssetFailure('Collection theme roles differ from the pinned preset');
}

/** Makes the mistake for an image whose stored media type differs: `missing-asset`. */
function mediaTypeDiffersFailure(assetId: string): AuthoringResult<never> {
  return missingAssetFailure(`Asset media type differs: ${assetId}`);
}
