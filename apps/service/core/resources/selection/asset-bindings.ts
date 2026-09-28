/*
 * The asset bindings one request may use: supplied uploads bound over the collection's earlier
 * bindings, an alias replacing only its own. Pure over Model and Assets. A refusal is
 * `missing-asset` and a malformed pinned digest `invalid-input`, both at `resources`
 * (refusal.ts). Authoring owns recovery.
 */
import type {
  Assets,
  AuthoringResult,
  Request,
  ResolvedResources,
  ResourceRequest,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import { bareDigest, isPinnedDigest, pinnedDigest } from '../../../contract/brands.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import {
  assetBindings,
  type AssetBinding,
  type BindingModel,
  type ThemeBinding,
} from '../../presets/theme-binding.js';
import { liveRecord } from '../../workspace/records.js';
import type { Declared } from './intent.js';
import type { Themes } from './themes.js';
import { checkedDigest } from './digests.js';
import { fromOwner, resourceRefused } from './refusal.js';

/** The owners asset binding reads: Assets for the bytes' media type, Model for the check. */
export interface AssetOwners {
  readonly model: BindingModel;
  readonly assets: Pick<Assets, 'resolve'>;
}

/** One supplied upload: an alias and the Assets digest of its bytes. */
type Upload = Request['assets'][number];

/**
 * Binds each supplied asset over the collection's earlier bindings; an alias replaces only its own.
 * Fails with `missing-asset` at `resources` when Model or Assets refuses, when no theme is
 * admitted, or when an upload has neither authored metadata nor an earlier binding of the same
 * bytes; `invalid-input` at `resources` when a pinned source digest is malformed.
 */
export function boundAssets(
  request: Request,
  declared: Declared,
  snapshot: Snapshot,
  resolvedThemes: Themes,
  owners: AssetOwners,
): AuthoringResult<ResolvedResources['assets']> {
  if (declared.kind === 'theme-admission') return success({});
  const previous = priorAssets(declared.collection, snapshot, owners.model);
  if (!previous.ok) return previous;
  const pinned = pinnedUploads(declared.requests);
  return andThen(pinned, (uploads) =>
    bindSupplied(
      [...uploads, ...request.assets],
      declared.requests,
      previous.value,
      resolvedThemes,
      owners,
    ),
  );
}

/**
 * Every supplied upload bound over the earlier bindings; with none supplied, the earlier
 * bindings as they are. Fails as `firstTheme` or `suppliedAsset` fails.
 */
function bindSupplied(
  supplied: readonly Upload[],
  requests: readonly ResourceRequest[],
  previous: readonly AssetBinding[],
  resolvedThemes: Themes,
  owners: AssetOwners,
): AuthoringResult<ResolvedResources['assets']> {
  if (supplied.length === 0) return success(byId(previous));
  const theme = firstTheme(resolvedThemes);
  if (!theme.ok) return theme;
  const bound = collect(
    supplied.map((item) => suppliedAsset(item, requests, previous, theme.value, owners)),
  );
  return andThen(bound, (bindings) => success(byId([...previous, ...bindings])));
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
  const record = liveRecord(snapshot, 'collection', id);
  if (!record) return success([]);
  return andThen(fromOwner(model.validate(record.value)), (collection) =>
    success(collection.assets),
  );
}

/**
 * Asset declarations whose source is a `sha256:` pin supply their bytes by digest. Fails with
 * `invalid-input` at `resources` when a pinned digest is not an Authoring digest.
 */
function pinnedUploads(requests: readonly ResourceRequest[]): AuthoringResult<readonly Upload[]> {
  const pinned = requests.filter((item) => item.kind !== 'theme' && isPinnedDigest(item.source));
  return collect(pinned.map(pinnedUpload));
}

/** One pinned declaration as an upload. Fails with `invalid-input` at `resources` on a malformed digest. */
function pinnedUpload(request: ResourceRequest): AuthoringResult<Upload> {
  const digest = checkedDigest(bareDigest(request.source));
  return andThen(digest, (checked) => success({ alias: request.alias, digest: checked }));
}

/**
 * Model checks an asset binding against one actual admitted theme. Fails with `missing-asset` at
 * `resources` ("Asset binding requires an admitted theme") when there is none.
 */
function firstTheme(themes: Themes): AuthoringResult<ThemeBinding> {
  const theme = Object.values(themes)[0];
  if (!theme) return resourceRefused('Asset binding requires an admitted theme');
  return success(theme);
}

/**
 * A new upload needs metadata in the source; otherwise an earlier binding must name the same
 * bytes. Fails with `missing-asset` at `resources` ("Missing authored asset metadata: <alias>")
 * when neither exists, or as `newAsset` fails.
 */
function suppliedAsset(
  upload: Upload,
  requests: readonly ResourceRequest[],
  previous: readonly AssetBinding[],
  theme: ThemeBinding,
  owners: AssetOwners,
): AuthoringResult<AssetBinding> {
  const metadata = requests.find((item) => item.alias === upload.alias && item.kind !== 'theme');
  if (metadata) return newAsset(upload, metadata, theme, owners);
  const existing = previous.find(
    (item) => item.id === upload.alias && item.digest === pinnedDigest(upload.digest),
  );
  if (!existing) return resourceRefused(`Missing authored asset metadata: ${upload.alias}`);
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
  owners: AssetOwners,
): AuthoringResult<AssetBinding> {
  const blob = fromOwner(owners.assets.resolve(upload.digest));
  if (!blob.ok) return blob;
  const draft = {
    id: upload.alias,
    digest: pinnedDigest(upload.digest),
    mediaType: blob.value.descriptor.mediaType,
    alt: metadata.alt ?? upload.alias,
    ...optionalMetadata(metadata),
  };
  const checked = fromOwner(assetBindings([draft], theme, owners.model));
  return andThen(checked, firstBinding);
}

/**
 * The one binding Model checked. Fails with `missing-asset` at `resources` ("Asset binding is
 * missing after owner validation") when Model returned none.
 */
function firstBinding(bindings: readonly AssetBinding[]): AuthoringResult<AssetBinding> {
  const [validated] = bindings;
  if (!validated) return resourceRefused('Asset binding is missing after owner validation');
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
