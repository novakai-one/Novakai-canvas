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
  Json,
  Request,
  ResolvedResources,
  ResourceRequest,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import { removeDigestPrefix, hasDigestPrefix, addDigestPrefix } from '../../../contract/brands.js';
import { collect, success } from '../../../contract/errors.js';
import type { AssetBinding, BindingModel, ThemeBinding } from '../../presets/theme-binding.js';
import { findLiveRecord } from '../../workspace/records.js';
import type { DeclaredResources } from './intent.js';
import type { Themes } from './themes.js';
import { checkDigest } from './digests.js';
import { bindNewAsset, type Upload } from './new-asset.js';
import { fromCapability, missingAssetFailure } from './refusal.js';

/** What binding files needs. */
export interface AssetBindingDependencies {
  /** Model's check of each binding. */
  readonly model: BindingModel;
  /** The file store, which says whether a file is stored and what its media type is. */
  readonly assets: Pick<Assets, 'resolve'>;
}

/** The files a change can use, keyed by the name its DSL gives them, such as `logo`. */
export type AssetBindings = ResolvedResources['assets'];

/** What a request's own source declares when it may bind assets. */
type DeclaredSources = Exclude<DeclaredResources, { readonly kind: 'theme-admission' }>;

/** What binding reads: the uploads to bind, their declarations and the earlier bindings. */
interface BindingInputs {
  /** Pinned declarations first, then the request's own uploads. */
  readonly supplied: readonly Upload[];
  /** The theme and asset lines the change's source declares. */
  readonly declaredLines: readonly ResourceRequest[];
  /** The saved collection's bindings; none for a new collection. */
  readonly earlier: readonly AssetBinding[];
}

/**
 * Answers the collection's file bindings with this change's files added. A new file replaces the
 * earlier binding with the same name. A theme being saved binds none.
 * Model only checks a binding inside a collection, and a collection needs a theme, so the check
 * borrows one of `availableThemes`. Fails with `missing-asset` when there is no theme to borrow,
 * a file has neither an `asset` line nor an earlier binding, or a capability refuses;
 * `invalid-input` for a bad `sha256:` digest.
 */
export function bindAssets(
  request: Request,
  declared: DeclaredResources,
  snapshot: Snapshot,
  availableThemes: Themes,
  dependencies: AssetBindingDependencies,
): AuthoringResult<AssetBindings> {
  if (declared.kind === 'theme-admission') {
    return success(NO_BINDINGS);
  }
  const inputs = bindingInputs(request, declared, snapshot, dependencies);
  if (!inputs.ok) {
    return inputs;
  }
  return bindSupplied(inputs.value, availableThemes, dependencies);
}

/** What a theme being saved binds: no files. */
const NO_BINDINGS: AssetBindings = Object.freeze({});

/** What a new collection, or one not saved yet, had bound before: no files. */
const NO_EARLIER_BINDINGS: readonly AssetBinding[] = Object.freeze([]);

/** Gathers the collection's earlier bindings, then the uploads to bind: pinned lines first. */
function bindingInputs(
  request: Request,
  declared: DeclaredSources,
  snapshot: Snapshot,
  dependencies: AssetBindingDependencies,
): AuthoringResult<BindingInputs> {
  const earlier = listEarlierBindings(declared.collection, snapshot, dependencies.model);
  if (!earlier.ok) {
    return earlier;
  }
  const pinned = pinnedUploads(declared.requests);
  if (!pinned.ok) {
    return pinned;
  }
  const supplied = [...pinned.value, ...request.assets];
  return success({ supplied, declaredLines: declared.requests, earlier: earlier.value });
}

/** Binds every supplied upload over the earlier bindings, borrowing a theme for Model's check. */
function bindSupplied(
  inputs: BindingInputs,
  availableThemes: Themes,
  dependencies: AssetBindingDependencies,
): AuthoringResult<AssetBindings> {
  if (inputs.supplied.length === 0) {
    const bindings = keyById(inputs.earlier);
    return success(bindings);
  }
  const theme = borrowTheme(availableThemes);
  if (!theme.ok) {
    return theme;
  }
  return bindEachUpload(inputs, theme.value, dependencies);
}

/** Binds each supplied upload in order, and lets it replace an earlier binding of the same name. */
function bindEachUpload(
  inputs: BindingInputs,
  theme: ThemeBinding,
  dependencies: AssetBindingDependencies,
): AuthoringResult<AssetBindings> {
  const bound = collect(inputs.supplied, (upload) =>
    bindUpload(upload, inputs, theme, dependencies),
  );
  if (!bound.ok) {
    return bound;
  }
  const bindings = keyById([...inputs.earlier, ...bound.value]);
  return success(bindings);
}

/** Lists the file bindings of the saved collection the change names, none for a new one. */
function listEarlierBindings(
  collectionId: string | null,
  snapshot: Snapshot,
  model: BindingModel,
): AuthoringResult<readonly AssetBinding[]> {
  if (collectionId === null) {
    return success(NO_EARLIER_BINDINGS);
  }
  const record = findLiveRecord(snapshot, 'collection', collectionId);
  if (record === undefined) {
    return success(NO_EARLIER_BINDINGS);
  }
  return listStoredBindings(record.value, model);
}

/** Has Model check the saved collection, then lists its file bindings. */
function listStoredBindings(
  storedCollection: Json,
  model: BindingModel,
): AuthoringResult<readonly AssetBinding[]> {
  const collection = fromCapability(model.validate(storedCollection));
  if (!collection.ok) {
    return collection;
  }
  return success(collection.value.assets);
}

/** Turns each `asset` line whose source is a `sha256:` pin into an upload of those bytes. */
function pinnedUploads(
  declaredLines: readonly ResourceRequest[],
): AuthoringResult<readonly Upload[]> {
  const pinnedLines = declaredLines.filter(isPinnedFileLine);
  return collect(pinnedLines, pinnedUpload);
}

/** Whether a line declares a file (not a theme) whose source is a `sha256:` pin. */
function isPinnedFileLine(line: ResourceRequest): boolean {
  return line.kind !== 'theme' && hasDigestPrefix(line.source);
}

/** Turns one pinned line into an upload, checking its digest as Authoring's. */
function pinnedUpload(line: ResourceRequest): AuthoringResult<Upload> {
  const bareDigest = removeDigestPrefix(line.source);
  const digest = checkDigest(bareDigest);
  if (!digest.ok) {
    return digest;
  }
  const upload: Upload = { alias: line.alias, digest: digest.value };
  return success(upload);
}

/** Picks the first available theme, for Model's check to borrow. */
function borrowTheme(themes: Themes): AuthoringResult<ThemeBinding> {
  const [theme] = Object.values(themes);
  if (theme === undefined) {
    return noThemeToBorrowFailure();
  }
  return success(theme);
}

/** Binds one upload from its `asset` line, or else reuses an earlier binding of the same bytes. */
function bindUpload(
  upload: Upload,
  inputs: BindingInputs,
  theme: ThemeBinding,
  dependencies: AssetBindingDependencies,
): AuthoringResult<AssetBinding> {
  const assetLine = findAssetLine(upload, inputs.declaredLines);
  if (assetLine !== undefined) {
    return bindNewAsset(upload, assetLine, theme, dependencies);
  }
  return reuseEarlierBinding(upload, inputs.earlier);
}

/** Finds the `asset` line that names this upload. */
function findAssetLine(
  upload: Upload,
  declaredLines: readonly ResourceRequest[],
): ResourceRequest | undefined {
  return declaredLines.find((line) => line.alias === upload.alias && line.kind !== 'theme');
}

/** Finds the earlier binding with this upload's name and bytes, refusing an upload with none. */
function reuseEarlierBinding(
  upload: Upload,
  earlier: readonly AssetBinding[],
): AuthoringResult<AssetBinding> {
  const prefixedDigest = addDigestPrefix(upload.digest);
  const reused = earlier.find(
    (binding) => binding.id === upload.alias && binding.digest === prefixedDigest,
  );
  if (reused === undefined) {
    return missingMetadataFailure(upload.alias);
  }
  return success(reused);
}

/** Keys the bindings by name; a later binding replaces an earlier one with the same name. */
function keyById(bindings: readonly AssetBinding[]): AssetBindings {
  const entries = bindings.map((binding) => [binding.id, binding] as const);
  return Object.fromEntries(entries);
}

/** Makes the mistake for files with no theme to borrow: `missing-asset` at `resources`. */
function noThemeToBorrowFailure(): AuthoringResult<never> {
  return missingAssetFailure('Asset binding requires an admitted theme');
}

/** Makes the mistake for an upload with no `asset` line and no earlier binding: `missing-asset`. */
function missingMetadataFailure(alias: string): AuthoringResult<never> {
  return missingAssetFailure(`Missing authored asset metadata: ${alias}`);
}
