/*
 * Why this file exists
 *
 * A change can use files, such as an image its DSL declares with
 * `asset @logo image source="./logo.png"`. The CLI uploads each file and sends its digest with the
 * change. Each file then needs a binding (name, digest, media type, alt text) that Model accepts.
 * A new upload replaces only the collection's earlier binding with the same name.
 *
 * This file makes the bindings for one change. Each step answers a `Result` (contract/errors.ts).
 * A file with no `asset` line and no earlier binding of the same bytes is `missing-asset`. It only
 * reads.
 */
import type {
  Assets,
  AuthoringResult,
  Request,
  ResolvedResources,
  ResourceRequest,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import { removeDigestPrefix, hasDigestPrefix, addDigestPrefix } from '../../../contract/brands.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import {
  assetBindings,
  type AssetBinding,
  type BindingModel,
  type ThemeBinding,
} from '../../presets/theme-binding.js';
import { findLiveRecord } from '../../workspace/records.js';
import type { DeclaredResources } from './intent.js';
import type { Themes } from './themes.js';
import { checkDigest } from './digests.js';
import { fromCapability, missingAssetFailure } from './refusal.js';

/** What binding files needs. */
export interface AssetBindingDependencies {
  /** Model's check of each binding. */
  readonly model: BindingModel;
  /** The file store, which says whether a file is stored and what its media type is. */
  readonly assets: Pick<Assets, 'resolve'>;
}

/** One supplied upload: an alias and the Assets digest of its bytes. */
type Upload = Request['assets'][number];

/** What a request's own source declares when it may bind assets. */
type DeclaredSources = Exclude<DeclaredResources, { readonly kind: 'theme-admission' }>;

/** What binding reads: the uploads to bind, their declarations and the earlier bindings. */
interface BindingInputs {
  /** Pinned declarations first, then the request's own uploads. */
  readonly supplied: readonly Upload[];
  readonly requests: readonly ResourceRequest[];
  readonly previous: readonly AssetBinding[];
}

/**
 * Binds each file the change supplies over its collection's earlier bindings, keyed by name. A
 * theme being saved binds none. Fails with `missing-asset` at `resources` when a capability
 * refuses, when no theme was picked, or when a file has neither an `asset` line nor an earlier
 * binding; `invalid-input` at `resources` when an `asset` line's `sha256:` digest is malformed.
 */
export function bindAssets(
  request: Request,
  declared: DeclaredResources,
  snapshot: Snapshot,
  resolvedThemes: Themes,
  dependencies: AssetBindingDependencies,
): AuthoringResult<ResolvedResources['assets']> {
  if (declared.kind === 'theme-admission') return success({});
  const inputs = bindingInputs(request, declared, snapshot, dependencies);
  if (!inputs.ok) return inputs;
  return bindSupplied(inputs.value, resolvedThemes, dependencies);
}

/**
 * The collection's earlier bindings, then the pinned declarations and the request's uploads.
 * Fails as `priorAssets` or `pinnedUploads` fails.
 */
function bindingInputs(
  request: Request,
  declared: DeclaredSources,
  snapshot: Snapshot,
  dependencies: AssetBindingDependencies,
): AuthoringResult<BindingInputs> {
  const previous = priorAssets(declared.collection, snapshot, dependencies.model);
  if (!previous.ok) return previous;
  const pinned = pinnedUploads(declared.requests);
  if (!pinned.ok) return pinned;
  const supplied = [...pinned.value, ...request.assets];
  return success({ supplied, requests: declared.requests, previous: previous.value });
}

/**
 * Every supplied upload bound over the earlier bindings, in order; with none supplied, the
 * earlier bindings as they are. Fails as `firstTheme` or `suppliedAsset` fails; uploads after
 * the first failure are not read.
 */
function bindSupplied(
  inputs: BindingInputs,
  resolvedThemes: Themes,
  dependencies: AssetBindingDependencies,
): AuthoringResult<ResolvedResources['assets']> {
  if (inputs.supplied.length === 0) return success(byId(inputs.previous));
  const theme = firstTheme(resolvedThemes);
  if (!theme.ok) return theme;
  const bound = collect(inputs.supplied, (upload) =>
    suppliedAsset(upload, inputs, theme.value, dependencies),
  );
  return andThen(bound, (bindings) => success(byId([...inputs.previous, ...bindings])));
}

/**
 * Earlier bindings belong to one collection; the same alias in another collection never leaks in.
 * None for a new collection (`null`) or one with no live record. Fails with `missing-asset` at
 * `resources` when Model refuses the stored collection.
 */
function priorAssets(
  id: string | null,
  snapshot: Snapshot,
  model: BindingModel,
): AuthoringResult<readonly AssetBinding[]> {
  if (id === null) return success([]);
  const record = findLiveRecord(snapshot, 'collection', id);
  if (!record) return success([]);
  return andThen(fromCapability(model.validate(record.value)), (collection) =>
    success(collection.assets),
  );
}

/**
 * Asset declarations whose source is a `sha256:` pin supply their bytes by digest. Fails with
 * `invalid-input` at `resources` when a pinned digest is not an Authoring digest.
 */
function pinnedUploads(requests: readonly ResourceRequest[]): AuthoringResult<readonly Upload[]> {
  const pinned = requests.filter((item) => item.kind !== 'theme' && hasDigestPrefix(item.source));
  return collect(pinned, pinnedUpload);
}

/** One pinned declaration as an upload. Fails with `invalid-input` at `resources` on a malformed digest. */
function pinnedUpload(request: ResourceRequest): AuthoringResult<Upload> {
  const digest = checkDigest(removeDigestPrefix(request.source));
  return andThen(digest, (checked) => success({ alias: request.alias, digest: checked }));
}

/**
 * Model checks an asset binding against one actual admitted theme. Fails with `missing-asset` at
 * `resources` ("Asset binding requires an admitted theme") when there is none.
 */
function firstTheme(themes: Themes): AuthoringResult<ThemeBinding> {
  const theme = Object.values(themes)[0];
  if (!theme) return missingAssetFailure('Asset binding requires an admitted theme');
  return success(theme);
}

/**
 * A new upload needs metadata in the source; otherwise an earlier binding must name the same
 * bytes. Fails with `missing-asset` at `resources` ("Missing authored asset metadata: <alias>")
 * when neither exists, or as `newAsset` fails.
 */
function suppliedAsset(
  upload: Upload,
  inputs: BindingInputs,
  theme: ThemeBinding,
  dependencies: AssetBindingDependencies,
): AuthoringResult<AssetBinding> {
  const metadata = inputs.requests.find(
    (item) => item.alias === upload.alias && item.kind !== 'theme',
  );
  if (metadata) return newAsset(upload, metadata, theme, dependencies);
  const existing = inputs.previous.find(
    (item) => item.id === upload.alias && item.digest === addDigestPrefix(upload.digest),
  );
  if (!existing) return missingAssetFailure(`Missing authored asset metadata: ${upload.alias}`);
  return success(existing);
}

/**
 * Assets resolves the bytes and their media type; Model checks the authored metadata. Fails with
 * `missing-asset` at `resources` when Assets or Model refuses (its failure kept in `source`), or
 * when Model returns no binding.
 */
function newAsset(
  upload: Upload,
  metadata: ResourceRequest,
  theme: ThemeBinding,
  dependencies: AssetBindingDependencies,
): AuthoringResult<AssetBinding> {
  const blob = fromCapability(dependencies.assets.resolve(upload.digest));
  if (!blob.ok) return blob;
  const draft = {
    id: upload.alias,
    digest: addDigestPrefix(upload.digest),
    mediaType: blob.value.descriptor.mediaType,
    alt: metadata.alt ?? upload.alias,
    ...optionalMetadata(metadata),
  };
  const checked = fromCapability(assetBindings([draft], theme, dependencies.model));
  return andThen(checked, firstBinding);
}

/**
 * The one binding Model checked. Fails with `missing-asset` at `resources` ("Asset binding is
 * missing after owner validation") when Model returned none.
 */
function firstBinding(bindings: readonly AssetBinding[]): AuthoringResult<AssetBinding> {
  const [validated] = bindings;
  if (!validated) return missingAssetFailure('Asset binding is missing after owner validation');
  return success(validated);
}

/** Licence and attribution stay absent unless the source writes them; none is invented. */
function optionalMetadata(metadata: ResourceRequest): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries({ license: metadata.license, attribution: metadata.attribution }).filter(
      (item): item is [string, string] => typeof item[1] === 'string',
    ),
  );
}

/** Asset bindings keyed by id; a later binding replaces an earlier one with the same id. */
function byId(bindings: readonly AssetBinding[]): ResolvedResources['assets'] {
  return Object.fromEntries(bindings.map((item) => [item.id, item]));
}
