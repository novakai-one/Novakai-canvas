/*
 * The headless render boundary: one read-only render runs in a temporary directory — admission,
 * lowering, projection, layout, export — and stored collections are never touched. Pure render
 * rules live in core/render behind contract/api.js, capability wiring in contract/render.js and
 * the Export stage in contract/render-export.js; file I/O, the temporary asset store and raster
 * start-up are injected (adapters/render/). This adapter owns the owner sequence and the
 * RenderAbort boundary: accepted() throws, renderHeadless converts it to a typed failure, and the
 * temporary directory is always removed.
 */
import { z } from 'zod';
import type { Assets } from '@novakai/canvas-assets';
import type { Catalog } from '@novakai/canvas-templates';
import { validate, type Collection } from '@novakai/canvas-model';
import type { RenderReport, RenderRequest } from '../../contract/records/render.js';
import type { ProviderFault, RenderFailure } from '../../contract/records/render-failure.js';
import type {
  AssetDigest,
  CollectionName,
  FilePath,
  PresetId,
  ThemeName,
} from '../../contract/brands.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { HeadlessOwners, TempDirectory } from '../../contract/ports/render.js';
import type { Result } from '../../contract/errors.js';
import type { ResourceRequest } from '../../contract/records/foreign.js';
import {
  RenderAbort,
  accepted,
  altText,
  credit,
  declaredResource,
  evidence,
  pinOf,
  renderReport,
  sourceMatches,
  sourceWithTheme,
} from '../../contract/api.js';
import { exportSections } from '../../contract/render-export.js';
import {
  environment,
  pinResources,
  renderJob,
  renderSnapshot,
  type Environment,
} from '../../contract/render.js';

/**
 * Render every section of one collection to files, read-only.
 *
 * Owner failures keep their structured evidence; unexpected filesystem failures become
 * `provider-failed`. Either way the render is `render-failed`, stored collections are
 * untouched, and the temporary admission directory is removed. A failure to create or remove
 * that directory is not a `render-failed` value: it escapes as an Error with the OS message.
 */
export async function renderHeadless(
  request: RenderRequest,
  owners: HeadlessOwners,
): Promise<Result<RenderReport, RenderFailure>> {
  const temp = escaped(await owners.temp.create());
  try {
    return { ok: true, value: await render(request, owners, temp) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'render-failed',
        message: 'Headless render rejected',
        recovery:
          'Correct the named input or resource and rerun; stored collections were not changed.',
        source: evidence(error),
      },
    };
  } finally {
    escaped(await temp.remove());
  }
}

/**
 * Unwrap a temporary-directory step. A failure throws a plain Error with the OS message, the
 * same line the host printed when mkdtemp and rm threw here directly.
 */
function escaped<T>(result: Result<T, ProviderFault>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Owner sequence: admission, lowering, projection, layout, export; assets always close. */
async function render(
  request: RenderRequest,
  owners: HeadlessOwners,
  temp: TempDirectory,
): Promise<RenderReport> {
  const assets = accepted(temp.openAssets());
  try {
    return await renderEnvironment(request, owners, await environment(request, owners, assets));
  } finally {
    accepted(assets.close());
  }
}

/** One prepared environment drives the whole render. */
async function renderEnvironment(
  request: RenderRequest,
  owners: HeadlessOwners,
  env: Environment,
): Promise<RenderReport> {
  const catalog = await themes(request, env, owners);
  const collection = await input(request, env, catalog, owners);
  const job = renderJob(request, owners, env, catalog, collection);
  const document = accepted(await owners.service.produceDiagram(job, new AbortController().signal));
  const snapshot = renderSnapshot(collection, document, catalog, env);
  const files = await exportSections(request, owners.files, snapshot, document, env, catalog);
  return renderReport(files, collection, document, catalog);
}

/** Shipped themes, then the --theme file, follow the same admission lifecycle as user files. */
async function themes(
  request: RenderRequest,
  env: Environment,
  owners: HeadlessOwners,
): Promise<Catalog> {
  const files = accepted(await owners.files.shippedThemes());
  const catalog = await files.reduce(
    async (prior, file) => admitTheme(file, await prior, env, owners),
    Promise.resolve(env.installation.presets),
  );
  if (request.themeFile === undefined) return catalog;
  return admitTheme(request.themeFile, catalog, env, owners);
}

/** Admitted theme files reuse the service preparation path and actual font asset descriptors. */
async function admitTheme(
  path: FilePath,
  catalog: Catalog,
  env: Environment,
  owners: HeadlessOwners,
): Promise<Catalog> {
  const theme = accepted(await owners.files.read(path));
  const source = accepted(owners.readTheme(theme.source));
  const bindings = await Promise.all(
    source.fonts.map(async (resource) => ({
      alias: resource.alias,
      digest: await admitResource(theme.file, resource, env.assets, owners),
    })),
  );
  const prepared = accepted(
    owners.service.prepareTheme(z.json().parse(source.admission), catalog, bindings, env),
  );
  return accepted(env.templates.planAdmission(catalog, prepared)).candidate;
}

/** Bounded, confined resource reads and exact Assets normalization from normal CLI admission. */
async function admitResource(
  file: FilePath,
  request: ResourceRequest,
  assets: Pick<Assets, 'stage' | 'resolve'>,
  owners: HeadlessOwners,
): Promise<AssetDigest> {
  const resource = accepted(await declaredResource(file, request, owners.resources));
  if (resource.kind === 'pinned') return resource.digest;
  return accepted(await assets.stage(resource.input)).descriptor.digest;
}

/** Override an ephemeral validated copy; never write or mutate the source collection or its pin. */
async function input(
  request: RenderRequest,
  env: Environment,
  catalog: Catalog,
  owners: HeadlessOwners,
): Promise<Collection> {
  const originalSource = await collectionSource(request, env, catalog, owners);
  const source = await overrideSource(originalSource, request, owners, env);
  const pins = pinResources(catalog);
  const assets = await sourceAssets(source, env, owners, pins.themes.paper);
  const bindings = pinResources(catalog, assets);
  const original = accepted(
    env.language.lower({
      source: source.source,
      mode: 'create',
      snapshot: null,
      resources: bindings,
    }),
  ).collection;
  const theme = await selectedTheme(request, owners);
  if (theme === null) return accepted(validate(original));
  const pin = bindings.themes[theme];
  if (!pin) throw new RenderAbort({ code: 'missing-theme', theme });
  return accepted(validate({ ...original, theme: pin }));
}

/** A `.canvas` file is read as given; a name selects a recipe, then a shipped collection. */
async function collectionSource(
  request: RenderRequest,
  env: Environment,
  catalog: Catalog,
  owners: HeadlessOwners,
): Promise<SourceFile> {
  if (request.collection.kind === 'file')
    return accepted(await owners.files.read(request.collection.path));
  return namedSource(request.collection.name, env, catalog, owners);
}

/** A recipe ID selects the recipe's shipped source; any other name, a shipped collection ID. */
async function namedSource(
  name: CollectionName,
  env: Environment,
  catalog: Catalog,
  owners: HeadlessOwners,
): Promise<SourceFile> {
  const recipe = catalog.find((preset) => preset.kind === 'recipe' && preset.id === String(name));
  if (recipe?.kind === 'recipe')
    return {
      source: recipe.payload.source,
      file: owners.files.recipeFile(recipe.payload.family),
    };
  return sourceFromId(name, env, owners);
}

/** Bare collection ids resolve from shipped semantic sources; filesystem paths stay explicit. */
async function sourceFromId(
  name: CollectionName,
  env: Environment,
  owners: HeadlessOwners,
): Promise<SourceFile> {
  const sources = accepted(await owners.files.shippedCollections());
  const matches = sources.filter((source) =>
    sourceMatches(source.source, name, env.language.parse),
  );
  const [match] = matches;
  if (matches.length !== 1 || match === undefined)
    throw new RenderAbort({ code: 'collection-selection', id: name, matches: matches.length });
  return match;
}

/**
 * The theme override: --theme, or else the --theme-file's `@id`; null without either. Without
 * one, the lowered collection keeps the pin Language resolved for its own theme.
 */
async function selectedTheme(
  request: RenderRequest,
  owners: HeadlessOwners,
): Promise<ThemeName | PresetId | null> {
  if (request.theme !== undefined) return request.theme;
  if (request.themeFile === undefined) return null;
  const theme = accepted(await owners.files.read(request.themeFile));
  return accepted(owners.readTheme(theme.source)).admission.id;
}

/** Source media uses normal confined reads, normalized bytes and Model-owned metadata validation. */
async function sourceAssets(
  source: SourceFile,
  env: Environment,
  owners: HeadlessOwners,
  theme: Collection['theme'] | undefined,
): Promise<Collection['assets']> {
  const parsed = accepted(env.language.parse(source.source));
  const entries = await Promise.all(
    parsed.resources
      .filter((request) => request.kind !== 'theme')
      .map(async (request) => {
        const digest = await admitResource(source.file, request, env.assets, owners);
        const blob = accepted(env.assets.resolve(digest));
        return {
          id: request.alias,
          digest: pinOf(digest),
          mediaType: blob.descriptor.mediaType,
          alt: altText(request),
          ...credit(request),
        };
      }),
  );
  return accepted(
    validate({
      schemaVersion: 1,
      id: 'headless-assets',
      revision: 0,
      title: 'Headless asset bindings',
      arrangement: { algorithm: 'grid' },
      theme,
      assets: entries,
    }),
  ).assets;
}

/** A render-only source copy replaces only the parsed theme value, even over unavailable pins. */
async function overrideSource(
  source: SourceFile,
  request: RenderRequest,
  owners: HeadlessOwners,
  env: Environment,
): Promise<SourceFile> {
  const selected = await selectedTheme(request, owners);
  if (selected === null) return source;
  return { ...source, source: sourceWithTheme(source.source, selected, env.language.parse) };
}
