/*
 * Why this file exists
 *
 * A change can bring a new file, such as a logo its DSL declares with
 * `asset @logo image source="./logo.png"`. Its binding needs the media type of the stored bytes,
 * and the alt text, licence and attribution the `asset` line writes. Model must accept it.
 *
 * This file makes that one binding: Assets says the media type, and Model checks the rest. A file
 * Assets doesn't store, or a binding Model refuses, is `missing-asset`. It only reads.
 * Each step answers a `Result` (contract/errors.ts).
 */
import type {
  Assets,
  AuthoringResult,
  Request,
  ResourceRequest,
} from '../../../contract/records/capability-types.js';
import { addDigestPrefix } from '../../../contract/brands.js';
import { success } from '../../../contract/errors.js';
import {
  checkAssetBindings,
  type AssetBinding,
  type AssetDraft,
  type BindingModel,
  type ThemeBinding,
} from '../../presets/theme-binding.js';
import { fromCapability, missingAssetFailure } from './refusal.js';

/** What binding a new file needs. */
export interface NewAssetDependencies {
  /** Model's check of the binding. */
  readonly model: BindingModel;
  /** The file store, which says whether the file is stored and what its media type is. */
  readonly assets: Pick<Assets, 'resolve'>;
}

/** One uploaded file: the name its DSL gives it, such as `logo`, and the digest of its bytes. */
export type Upload = Request['assets'][number];

/**
 * Makes the binding for one new file, from its upload and the `asset` line that declares it.
 * Model checks it next to `theme`, because Model only checks a binding inside a collection.
 * Fails with `missing-asset` at `resources` when Assets or Model refuses (its failure kept as
 * `source`), or when Model answers with no binding.
 */
export function bindNewAsset(
  upload: Upload,
  assetLine: ResourceRequest,
  theme: ThemeBinding,
  dependencies: NewAssetDependencies,
): AuthoringResult<AssetBinding> {
  const storedFile = fromCapability(dependencies.assets.resolve(upload.digest));
  if (!storedFile.ok) {
    return storedFile;
  }
  const draft = draftBinding(upload, assetLine, storedFile.value.descriptor.mediaType);
  const checked = fromCapability(checkAssetBindings([draft], theme, dependencies.model));
  if (!checked.ok) {
    return checked;
  }
  return onlyBinding(checked.value);
}

/** Builds the binding Model checks: name, digest, stored media type, and the line's metadata. */
function draftBinding(
  upload: Upload,
  assetLine: ResourceRequest,
  mediaType: string,
): AssetDraft {
  const draft: AssetDraft = {
    id: upload.alias,
    digest: addDigestPrefix(upload.digest),
    mediaType,
    alt: assetLine.alt ?? upload.alias,
  };
  const licensed = addLicense(draft, assetLine);
  return addAttribution(licensed, assetLine);
}

/** Adds the licence the asset line wrote; a line with none adds nothing. */
function addLicense(
  draft: AssetDraft,
  assetLine: ResourceRequest,
): AssetDraft {
  if (assetLine.license === undefined) {
    return draft;
  }
  return { ...draft, license: assetLine.license };
}

/** Adds the attribution the asset line wrote; a line with none adds nothing. */
function addAttribution(
  draft: AssetDraft,
  assetLine: ResourceRequest,
): AssetDraft {
  if (assetLine.attribution === undefined) {
    return draft;
  }
  return { ...draft, attribution: assetLine.attribution };
}

/** Takes the one binding Model checked, refusing an answer with none. */
function onlyBinding(bindings: readonly AssetBinding[]): AuthoringResult<AssetBinding> {
  const [validated] = bindings;
  if (validated === undefined) {
    return bindingMissingFailure();
  }
  return success(validated);
}

/** Makes the mistake for Model answering with no binding: `missing-asset` at `resources`. */
function bindingMissingFailure(): AuthoringResult<never> {
  return missingAssetFailure('Asset binding is missing after owner validation');
}
