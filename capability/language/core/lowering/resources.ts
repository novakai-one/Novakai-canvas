/*
 * Themes and assets: the resource requests a source makes, and the check of the host's resolved
 * resources against them. Language never searches a registry or reads resource bytes; the host
 * resolves and admits resources before lowering. No side effects. Language owns correcting the
 * source; Authoring owns commit recovery.
 */
import type { Declaration, Span, Operation } from '../../contract/records/syntax.js';
import type { ResourceRequest, ResolvedResources } from '../../contract/records/requests.js';
import { field, id, text, textOr, optional, type RawRecord } from './fields.js';
import { reject } from '../validation/outcomes.js';
import { copySpan } from '../validation/ownership.js';
import { defaults } from '../vocabulary/defaults.js';

/** The asset attributes that must equal the admitted record when written. */
const checkedMetadata: readonly string[] = ['alt', 'license', 'attribution'];

/**
 * A theme's exact pin, `id@version#digest`. Printing and theme resolution both use it; the
 * digest is already prefixed (for example `sha256:`).
 */
export function themePin(theme: ResolvedResources['themes'][string]): string {
  return `${theme.id}@${theme.version}#${theme.digest}`;
}

/**
 * Finds the resolved theme for a written theme: first by alias (the `themes` key), then by exact
 * pin. The written text must then be the theme's ID (for an alias) or its full pin (when it
 * contains `#`).
 *
 * @throws A `LanguageFault` with a `missing-resource` diagnostic when no theme matches, or a
 * `resource-mismatch` diagnostic when the written text is not the theme's ID or pin.
 */
export function resolveTheme(
  alias: string,
  resources: ResolvedResources,
  span: Span,
): ResolvedResources['themes'][string] {
  const direct = resources.themes[alias];
  const found = direct ?? findPinnedTheme(alias, resources);
  if (found === undefined)
    reject(
      'missing-resource',
      span,
      'Supplied exact theme metadata',
      'Theme was not resolved',
      alias,
    );
  checkThemeIdentity(alias, found, span);
  return structuredClone(found);
}

/**
 * Lowers an asset declaration to the host's admitted asset record, under the written ID. The
 * written `source` (when a `sha256:` digest), `alt`, `license` and `attribution` must match the
 * admitted record, and an image or icon must have `alt` text.
 *
 * @throws A `LanguageFault`: a fault reading the ID, kind or source; `missing-resource` for an
 * asset not admitted; `invalid-value` for an image or icon without `alt`; and
 * `resource-mismatch` for a digest or metadata that differs.
 */
export function lowerAsset(
  item: Declaration,
  resources: ResolvedResources,
): RawRecord {
  const alias = id(item.fields);
  const record = resources.assets[alias];
  if (record === undefined)
    reject(
      'missing-resource',
      item.span,
      'Admitted asset metadata',
      'Asset has not been admitted',
      alias,
    );
  checkAssetRequest(item, record);
  return structuredClone({ ...record, id: alias });
}

/**
 * The resource requests of a document: always its theme first (`paper` when not written), then
 * each top-level asset in written order.
 *
 * @throws A `LanguageFault` from `assetRequest`: `invalid-value` for an unknown asset kind, or a
 * fault reading an asset's ID or source.
 */
export function documentResources(item: Declaration): readonly ResourceRequest[] {
  const theme = textOr(item.fields, 'theme', defaults.theme);
  return [themeRequest(theme, item.span), ...assetRequests(item)];
}

/**
 * The resource requests of one patch operation: the asset an operation declares; for a
 * collection target, the theme it sets, or `paper` when it unsets `theme`; otherwise none.
 *
 * @throws A `LanguageFault` from `assetRequest`: `invalid-value` for an unknown asset kind, or a
 * fault reading an asset's ID or source.
 */
export function patchResources(operation: Operation): readonly ResourceRequest[] {
  if (operation.declaration?.kind === 'asset') return [assetRequest(operation.declaration)];
  if (operation.target !== 'collection') return [];
  return patchThemeRequest(operation);
}

/**
 * The resource request for one asset declaration, so the host can resolve and admit it before
 * lowering. The request holds a copy of the span. No bytes are read here.
 *
 * @throws A `LanguageFault` with an `invalid-value` diagnostic for a kind other than `image`,
 * `icon` or `font`, and the faults of reading the ID or source.
 */
function assetRequest(item: Declaration): ResourceRequest {
  const kind = text(item.fields, 'kind');
  if (kind !== 'image' && kind !== 'icon' && kind !== 'font')
    reject('invalid-value', item.span, 'image / icon / font', 'Unknown resource kind');
  return {
    kind,
    alias: id(item.fields),
    source: text(item.fields, 'source'),
    ...optional('alt', item.fields.alt?.value),
    ...optional('license', item.fields.license?.value),
    ...optional('attribution', item.fields.attribution?.value),
    span: copySpan(item.span),
  };
}

/** The first resolved theme whose pin is exactly `alias`. */
function findPinnedTheme(
  alias: string,
  resources: ResolvedResources,
): ResolvedResources['themes'][string] | undefined {
  const themes = Object.values(resources.themes);
  return themes.find((theme) => themePin(theme) === alias);
}

/** Rejects a written theme that is not the theme's pin (when it has `#`) or else its ID. */
function checkThemeIdentity(
  alias: string,
  theme: ResolvedResources['themes'][string],
  span: Span,
): void {
  const expected = alias.includes('#') ? themePin(theme) : theme.id;
  if (alias !== expected)
    reject(
      'resource-mismatch',
      span,
      expected,
      'Theme metadata does not match the requested identity',
      alias,
    );
}

/** Checks `alt`, then a `sha256:` source against the admitted digest, then the metadata. */
function checkAssetRequest(
  item: Declaration,
  record: ResolvedResources['assets'][string],
): void {
  checkAlt(item);
  const source = text(item.fields, 'source');
  if (source.startsWith('sha256:') && source !== record.digest)
    reject(
      'resource-mismatch',
      item.span,
      source,
      'Asset digest differs from admitted bytes',
      id(item.fields),
    );
  checkedMetadata.forEach((name) => checkMetadata(item, record, name));
}

/** Rejects an image or icon without `alt`; a font's metadata may supply it. */
function checkAlt(item: Declaration): void {
  if (text(item.fields, 'kind') === 'font') return;
  if (item.fields.alt === undefined)
    reject(
      'invalid-value',
      item.span,
      'alt="Accessible description"',
      'Image/icon alt text is required',
      id(item.fields),
    );
}

/** Rejects a written attribute whose value differs from the admitted record's. */
function checkMetadata(
  item: Declaration,
  record: RawRecord,
  name: string,
): void {
  if (item.fields[name] === undefined) return;
  if (field(item.fields, name).value !== record[name])
    reject(
      'resource-mismatch',
      item.span,
      'Matching admitted metadata',
      'Asset metadata differs from admission',
      name,
    );
}

/** A set theme asks for that theme; an unset theme asks for `paper`; otherwise nothing. */
function patchThemeRequest(operation: Operation): readonly ResourceRequest[] {
  const theme = operation.fields.theme?.value;
  if (typeof theme === 'string') return [themeRequest(theme, operation.span)];
  if (operation.properties.includes('theme')) return [themeRequest(defaults.theme, operation.span)];
  return [];
}

/** The request for one theme: the written alias is also its source; the span is a copy. */
function themeRequest(
  alias: string,
  span: Span,
): ResourceRequest {
  return { kind: 'theme', alias, source: alias, span: copySpan(span) };
}

/** The requests of a collection's top-level assets, in written order. */
function assetRequests(item: Declaration): readonly ResourceRequest[] {
  const assets = item.children.filter((child) => child.kind === 'asset');
  return assets.map(assetRequest);
}
