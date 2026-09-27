/*
 * Resource selection: the theme and asset bindings one request may use, and whether a collection's
 * pins still match the stored presets and bytes. Pure over the injected owners; Authoring owns
 * commit and recovery.
 */
import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import type {
  Assets,
  AuthoringResult,
  Catalog,
  Collection,
  Digest,
  Language,
  LoweredIntent,
  Preset,
  Request,
  ResolvedResources,
  ResourceRequest,
  Snapshot,
  Templates,
  ThemePreset,
} from '../../../contract/records/capabilities.js';
import type { ModelRules } from '../../../contract/ports/capabilities.js';
import type {
  ResourceSelector,
  ResourceSelection,
} from '../../../contract/records/planning/planning.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import type { DslCommand, PresetAdmission } from '../../../contract/records/planning/commands.js';
import {
  dslCommand,
  modelCommand,
  presetChange,
} from '../../../contract/records/planning/commands.js';
import { authoringDigest, json } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';

/** The owners selection reads through; compose passes them from ServiceCapabilities and the workspace. */
export interface ResourceOwners {
  readonly model: Pick<ModelRules, 'validate'>;
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'readCatalog' | 'read'>;
  readonly language: Pick<Language, 'parse'>;
  /** The fixed installation presets a bootstrap request reads. */
  readonly installation: Catalog;
}
/** Model digests carry this prefix; Assets and Authoring digests do not. */
const PIN_PREFIX = 'sha256:';
type ThemeBinding = Collection['theme'];
type AssetBinding = Collection['assets'][number];
type Themes = ResolvedResources['themes'];
type Upload = Request['assets'][number];
/** The request payload, decoded once. Only DSL, model and preset changes are read. */
type Intent =
  | { readonly planner: 'dsl'; readonly command: DslCommand }
  | { readonly planner: 'model'; readonly collection: string }
  | { readonly planner: 'preset'; readonly admission: PresetAdmission }
  | { readonly planner: 'other' };
/** What the request's own source declares. A theme admission binds no assets. */
type Declared =
  | { readonly kind: 'theme-admission' }
  | {
      readonly kind: 'sources';
      readonly collection: string | null;
      readonly requests: readonly ResourceRequest[];
    };
/**
 * Selects a request's resources and checks a collection's pins; Authoring owns commit and recovery.
 * Refuses with `missing-asset` (owner failure kept in `source`) or `invalid-input` (undecodable payload).
 */
export function createResourceSelector(owners: ResourceOwners): ResourceSelector {
  return {
    select: (request, snapshot) => guarded(() => select(request, snapshot, owners)),
    forCollection: (collection, workspace) =>
      guarded(() => collectionResources(collection, workspace, owners)),
  };
}
/** A refusal raised inside a selection step; the public boundary turns it into a typed failure. */
class ResourceFault extends Error {
  /** Input refusals carry no source; owner refusals keep the owner's own failure. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}
/** Runs one selection and returns any refusal as Authoring's typed failure, before a lease or write exists. */
function guarded<T>(operation: () => T): AuthoringResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return rejected(error);
  }
}
/** A selection refusal asks for a resource fix; any other throw is a decode failure and leaks no native message. */
function rejected(error: unknown): AuthoringResult<never> {
  if (error instanceof ResourceFault)
    return authoringFailure('missing-asset', 'resources', error.message, [], error.source);
  return authoringFailure('invalid-input', 'resources', 'Resource request could not be decoded');
}
/** Returns the owner's value, or refuses with the owner's failure. Nothing missing is replaced by a default. */
function accepted<T>(result: AuthoringResult<T, FailureSource>): T {
  if (!result.ok)
    throw new ResourceFault('The owning capability rejected this input', result.error);
  return result.value;
}
/** Resolves theme and asset aliases, the bytes to hold until commit, and the preset records read. */
function select(
  request: Request,
  snapshot: Snapshot,
  owners: ResourceOwners,
): ResourceSelection {
  const catalog = presets(request, snapshot, owners);
  const available = themes(catalog, owners);
  // Decoded after the owner reads, so a broken catalog is still reported before a bad payload.
  const intent = decodeIntent(request);
  const resolvedThemes = pinnedThemes(intent, available);
  const declared = declaredResources(intent, owners);
  const resources = {
    themes: resolvedThemes,
    assets: assets(request, declared, snapshot, resolvedThemes, owners),
  };
  return {
    resources,
    pins: json.parse({ resources }),
    covered: coverage(request, snapshot, catalog, resources.assets),
    reads: presetReads(snapshot),
  };
}
/** Bootstrap reads the fixed installation presets; every other request reads the stored ones. */
function presets(
  request: Request,
  snapshot: Snapshot,
  owners: ResourceOwners,
): Catalog {
  if (request.intent.kind === 'change' && request.intent.planner === 'bootstrap')
    return owners.installation;
  return storedPresets(snapshot, owners);
}
/** Templates decodes the whole stored catalog, checking hashes and dependencies of every version, selected or not. */
function storedPresets(
  snapshot: Snapshot,
  owners: ResourceOwners,
): Catalog {
  return accepted(
    owners.templates.readCatalog(
      snapshot.records
        .filter((item) => item.key.kind === 'preset' && !item.deleted)
        .map((item) => item.value),
    ),
  );
}
/** Every theme version under its exact pin, then each theme id under its latest version. */
function themes(
  catalog: Catalog,
  owners: ResourceOwners,
): Themes {
  const records = themePresets(catalog);
  const exact = records.map(
    (item) =>
      [`${item.id}@${item.version}#${prefixed(item.digest)}`, binding(item, owners.model)] as const,
  );
  const aliases = unique(records.map((item) => item.id)).map(
    (id) => [id, latestBinding(catalog, id, owners)] as const,
  );
  return Object.fromEntries([...exact, ...aliases]);
}
/** The catalog's theme presets, in catalog order. */
function themePresets(catalog: Catalog): readonly ThemePreset[] {
  return catalog.filter((item) => item.kind === 'theme');
}
/** The binding for a theme id's latest version; Templates decides which version is latest. */
function latestBinding(
  catalog: Catalog,
  id: string,
  owners: ResourceOwners,
): ThemeBinding {
  return binding(accepted(owners.templates.read(catalog, { kind: 'theme', id })), owners.model);
}
/** A theme preset as Model's checked theme binding. */
function binding(
  preset: Preset,
  model: ResourceOwners['model'],
): ThemeBinding {
  if (preset.kind !== 'theme') throw new ResourceFault('Selected preset is not a theme');
  const theme = {
    id: preset.id,
    version: preset.version,
    digest: prefixed(preset.digest),
    roles: preset.payload.roles,
  };
  return validBinding({ title: 'Resource binding', theme }, model).theme;
}
/** Model checks the bindings inside the smallest possible collection, so this file never copies Model's rules. */
function validBinding(
  fields: Readonly<Record<string, unknown>>,
  model: ResourceOwners['model'],
): Collection {
  const base = { schemaVersion: 1, id: 'binding', revision: 0, arrangement: { algorithm: 'grid' } };
  return accepted(model.validate({ ...base, ...fields }));
}
/** Checks a resource-carrying payload against its planner's envelope; undo, redo and other planners are not read. */
function decodeIntent(request: Request): Intent {
  if (request.intent.kind !== 'change') return { planner: 'other' };
  const { planner, payload } = request.intent;
  switch (planner) {
    case 'dsl':
      return { planner: 'dsl', command: dslCommand.parse(payload) };
    case 'model':
      return { planner: 'model', collection: modelCommand.parse(payload).collection };
    case 'preset':
      return { planner: 'preset', admission: presetChange.parse(payload).admission };
    default:
      return { planner: 'other' };
  }
}
/** A retained DSL request keeps its exact theme pins; a newer latest version never replaces those bytes. */
function pinnedThemes(
  intent: Intent,
  available: Themes,
): Themes {
  if (intent.planner !== 'dsl') return available;
  const pins = Object.entries(intent.command.themePins ?? {}).map(
    ([alias, exact]) => [alias, exactTheme(available, exact)] as const,
  );
  return { ...available, ...Object.fromEntries(pins) };
}
/** The theme a retained pin names, which must still be in the current catalog. */
function exactTheme(
  available: Themes,
  exact: string,
): ThemeBinding {
  const pin = available[exact];
  if (!pin) throw new ResourceFault(`Retained theme pin unavailable: ${exact}`);
  return pin;
}
/** Only checked DSL or recipe source declares resources, read by Language; no JSON field is taken as a file path. */
function declaredResources(
  intent: Intent,
  owners: ResourceOwners,
): Declared {
  switch (intent.planner) {
    case 'dsl': {
      const parsed = accepted(owners.language.parse(intent.command.source));
      return { kind: 'sources', collection: parsed.collection, requests: parsed.resources };
    }
    case 'model':
      return { kind: 'sources', collection: intent.collection, requests: [] };
    case 'preset':
      return presetSources(intent.admission, owners);
    case 'other':
      return { kind: 'sources', collection: null, requests: [] };
  }
}
/** A recipe's source declares its assets; a theme's font bytes are held directly, never bound as assets. */
function presetSources(
  admission: PresetAdmission,
  owners: ResourceOwners,
): Declared {
  if (admission.kind === 'theme') return { kind: 'theme-admission' };
  const parsed = accepted(owners.language.parse(admission.source ?? ''));
  return { kind: 'sources', collection: null, requests: parsed.resources };
}
/** Binds each supplied asset over the collection's earlier bindings; an alias replaces only its own. */
function assets(
  request: Request,
  declared: Declared,
  snapshot: Snapshot,
  resolvedThemes: Themes,
  owners: ResourceOwners,
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
/** Earlier bindings belong to one collection; the same alias in another collection never leaks in. */
function priorAssets(
  id: string | null,
  snapshot: Snapshot,
  model: ResourceOwners['model'],
): readonly AssetBinding[] {
  const record = snapshot.records.find(
    (item) => item.key.kind === 'collection' && item.key.id === id && !item.deleted,
  );
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
  owners: ResourceOwners,
): AssetBinding {
  const metadata = requests.find((item) => item.alias === upload.alias && item.kind !== 'theme');
  if (metadata) return newAsset(upload, metadata, theme, owners);
  const existing = previous.find(
    (item) => item.id === upload.alias && item.digest === prefixed(upload.digest),
  );
  if (!existing) throw new ResourceFault(`Missing authored asset metadata: ${upload.alias}`);
  return existing;
}
/** Assets resolves the bytes and their media type; Model checks the authored metadata. */
function newAsset(
  upload: Upload,
  metadata: ResourceRequest,
  theme: ThemeBinding,
  owners: ResourceOwners,
): AssetBinding {
  const blob = accepted(owners.assets.resolve(upload.digest));
  const asset = {
    id: upload.alias,
    digest: prefixed(upload.digest),
    mediaType: blob.descriptor.mediaType,
    alt: metadata.alt ?? upload.alias,
    ...optionalMetadata(metadata),
  };
  const validated = validBinding({ title: 'Asset binding', theme, assets: [asset] }, owners.model)
    .assets[0];
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
/** Bytes held until commit: records, uploads and theme fonts sorted, then newly bound bytes in binding order. */
function coverage(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
  bound: ResolvedResources['assets'],
): readonly Digest[] {
  const held = sortedDigests([
    ...snapshot.records.flatMap((item) => item.resources),
    ...request.assets.map((item) => item.digest),
    ...themePresets(catalog).flatMap((item) => item.payload.fonts),
  ]);
  const bytes = Object.values(bound).map((item) => authoringDigest.parse(bare(item.digest)));
  return unique([...held, ...bytes]);
}
/** Every preset record, deleted ones included, is a read dependency of the selection. */
function presetReads(snapshot: Snapshot): ResourceSelection['reads'] {
  return snapshot.records
    .filter((item) => item.key.kind === 'preset')
    .map((item) => ({ key: item.key, version: item.version }));
}
/** A collection's theme pin must name a stored theme; its fonts and asset bytes are returned sorted. */
function collectionResources(
  collection: Collection,
  view: WorkspaceContents,
  owners: ResourceOwners,
): readonly Digest[] {
  const theme = accepted(
    owners.templates.read(view.presets, {
      kind: 'theme',
      id: collection.theme.id,
      version: collection.theme.version,
      digest: bare(collection.theme.digest),
    }),
  );
  if (theme.kind !== 'theme') throw new ResourceFault('Collection pin does not identify a theme');
  checkRoles(collection.theme.roles, theme.payload.roles);
  checkMediaTypes(collection.assets, owners);
  return sortedDigests([
    ...theme.payload.fonts,
    ...collection.assets.map((item) => bare(item.digest)),
  ]);
}
/** The collection's theme roles must equal the pinned preset's roles, in any order. */
function checkRoles(
  pinned: readonly string[],
  preset: readonly string[],
): void {
  if (JSON.stringify(pinned.toSorted()) !== JSON.stringify(preset.toSorted()))
    throw new ResourceFault('Collection theme roles differ from the pinned preset');
}
/** Each asset's stored bytes must still have the media type the collection records. */
function checkMediaTypes(
  bindings: readonly AssetBinding[],
  owners: ResourceOwners,
): void {
  bindings.forEach((item) => {
    const blob = accepted(owners.assets.resolve(bare(item.digest)));
    if (blob.descriptor.mediaType !== item.mediaType)
      throw new ResourceFault(`Asset media type differs: ${item.id}`);
  });
}
/** Distinct digests in sorted order, each checked as an Authoring digest. */
function sortedDigests(values: readonly string[]): readonly Digest[] {
  return unique(values)
    .toSorted()
    .map((value) => authoringDigest.parse(value));
}
/** Distinct values, each at its first position. */
function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
/** Asset bindings keyed by id; a later binding replaces an earlier one with the same id. */
function byId(bindings: readonly AssetBinding[]): ResolvedResources['assets'] {
  return Object.fromEntries(bindings.map((item) => [item.id, item]));
}
/** Model's form of an Assets digest. */
function prefixed(value: string): string {
  return `${PIN_PREFIX}${value}`;
}
/** Assets' form of a Model digest: the `sha256:` prefix removed. */
function bare(value: string): string {
  return value.slice(PIN_PREFIX.length);
}
