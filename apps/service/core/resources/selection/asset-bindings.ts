/*
 * The asset bindings one request may use: supplied uploads bound over the collection's earlier
 * bindings, an alias replacing only its own. Pure over Model and Assets. A refusal throws
 * ResourceFault (select.ts turns it into `missing-asset`); a malformed pinned digest throws zod's
 * error (`invalid-input`). Authoring owns recovery.
 */
import type {
  Assets,
  Request,
  ResolvedResources,
  ResourceRequest,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import { authoringDigest } from '../../../contract/schemas.js';
import {
  assetBindings,
  type AssetBinding,
  type BindingModel,
  type ThemeBinding,
} from '../../presets/theme-binding.js';
import { liveRecord } from '../../workspace/records.js';
import type { Declared } from './intent.js';
import type { Themes } from './themes.js';
import { PIN_PREFIX, bare, prefixed } from './digests.js';
import { ResourceFault, accepted } from './refusal.js';

/** The owners asset binding reads: Assets for the bytes' media type, Model for the check. */
export interface AssetOwners {
  readonly model: BindingModel;
  readonly assets: Pick<Assets, 'resolve'>;
}

/** One supplied upload: an alias and the Assets digest of its bytes. */
type Upload = Request['assets'][number];

/**
 * Binds each supplied asset over the collection's earlier bindings; an alias replaces only its own.
 * Throws ResourceFault when Model or Assets refuses, when no theme is admitted, or when an upload
 * has neither authored metadata nor an earlier binding of the same bytes.
 */
export function boundAssets(
  request: Request,
  declared: Declared,
  snapshot: Snapshot,
  resolvedThemes: Themes,
  owners: AssetOwners,
): ResolvedResources['assets'] {
  if (declared.kind === 'theme-admission') return {};
  const previous = priorAssets(declared.collection, snapshot, owners.model);
  const supplied = [...pinnedUploads(declared.requests), ...request.assets];
  if (supplied.length === 0) return byId(previous);
  const theme = firstTheme(resolvedThemes);
  const bound = supplied.map((item) =>
    suppliedAsset(item, declared.requests, previous, theme, owners),
  );
  return byId([...previous, ...bound]);
}

/**
 * Earlier bindings belong to one collection; the same alias in another collection never leaks in.
 * None for a new collection (`null`) or one with no live record.
 */
function priorAssets(
  id: string | null,
  snapshot: Snapshot,
  model: BindingModel,
): readonly AssetBinding[] {
  if (id === null) return [];
  const record = liveRecord(snapshot, 'collection', id);
  if (!record) return [];
  return accepted(model.validate(record.value)).assets;
}

/** Asset declarations whose source is a `sha256:` pin supply their bytes by digest. */
function pinnedUploads(requests: readonly ResourceRequest[]): readonly Upload[] {
  return requests
    .filter((item) => item.kind !== 'theme' && item.source.startsWith(PIN_PREFIX))
    .map((item) => ({ alias: item.alias, digest: authoringDigest.parse(bare(item.source)) }));
}

/** Model checks an asset binding against one actual admitted theme. */
function firstTheme(themes: Themes): ThemeBinding {
  const theme = Object.values(themes)[0];
  if (!theme) throw new ResourceFault('Asset binding requires an admitted theme');
  return theme;
}

/** A new upload needs metadata in the source; otherwise an earlier binding must name the same bytes. */
function suppliedAsset(
  upload: Upload,
  requests: readonly ResourceRequest[],
  previous: readonly AssetBinding[],
  theme: ThemeBinding,
  owners: AssetOwners,
): AssetBinding {
  const metadata = requests.find((item) => item.alias === upload.alias && item.kind !== 'theme');
  if (metadata) return newAsset(upload, metadata, theme, owners);
  const existing = previous.find(
    (item) => item.id === upload.alias && item.digest === prefixed(upload.digest),
  );
  if (!existing) throw new ResourceFault(`Missing authored asset metadata: ${upload.alias}`);
  return existing;
}

/**
 * Assets resolves the bytes and their media type; Model checks the authored metadata. Throws
 * ResourceFault with the Assets or Model failure in `source`, or when Model returns no binding.
 */
function newAsset(
  upload: Upload,
  metadata: ResourceRequest,
  theme: ThemeBinding,
  owners: AssetOwners,
): AssetBinding {
  const blob = accepted(owners.assets.resolve(upload.digest));
  const draft = {
    id: upload.alias,
    digest: prefixed(upload.digest),
    mediaType: blob.descriptor.mediaType,
    alt: metadata.alt ?? upload.alias,
    ...optionalMetadata(metadata),
  };
  const [validated] = accepted(assetBindings([draft], theme, owners.model));
  if (!validated) throw new ResourceFault('Asset binding is missing after owner validation');
  return validated;
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
