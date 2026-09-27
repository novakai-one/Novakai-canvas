/*
 * The headless render boundary: one read-only render runs in a temporary directory — admission,
 * lowering, projection, layout, export — and stored collections are never touched. Pure render
 * rules live in core/render behind contract/api.js and capability wiring in contract/render.js;
 * this adapter owns the filesystem, the owner sequence, and the RenderFault boundary:
 * accepted() throws, renderHeadless converts the fault to a typed failure, and the temporary
 * directory is always removed.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { openAssets, type Assets } from '@novakai/canvas-assets';
import type { RenderDocument } from '@novakai/canvas-service';
import type { Catalog } from '@novakai/canvas-templates';
import { validate, type Collection } from '@novakai/canvas-model';
import { createReactBindings } from '@novakai/canvas-presentation';
import { composeExport, initializeRaster, type Snapshot } from '@novakai/canvas-export';
import {
  filePath,
  headlessFault,
  sourceFile,
  type FilePath,
  type HeadlessFailure,
  type HeadlessOptions,
  type HeadlessOwners,
  type HeadlessReport,
  type SourceFile,
} from '../../contract/records/headless.js';
import type { Result } from '../../contract/errors.js';
import type { LocalInput, ResourceRequest } from '../../contract/records/resources.js';
import {
  RenderFault,
  accepted,
  assetAttribution,
  evidence,
  renderReport,
  resourceInspector,
  sourceMatches,
  sourceWithTheme,
} from '../../contract/api.js';
import {
  environment,
  exportDocuments,
  pinResources,
  renderJob,
  renderSnapshot,
  themeSelection,
  type Environment,
} from '../../contract/render.js';

/** A staged resource's content digest. */
type StagedDigest = NonNullable<LocalInput['digest']>;

/**
 * Render every section of one collection to files, read-only.
 *
 * Owner failures keep their structured evidence; unexpected filesystem failures become
 * `provider-failed`. Either way the render is `render-failed`, stored collections are
 * untouched, and the temporary admission directory is removed.
 */
export async function renderHeadless(
  options: HeadlessOptions,
  owners: HeadlessOwners,
): Promise<Result<HeadlessReport, HeadlessFailure>> {
  const directory = filePath.parse(await mkdtemp(join(tmpdir(), 'canvas-render-')));
  try {
    return { ok: true, value: await render(options, owners, directory) };
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
    await rm(directory, { recursive: true, force: true });
  }
}

/** Owner sequence: admission, lowering, projection, layout, export; assets always close. */
async function render(
  options: HeadlessOptions,
  owners: HeadlessOwners,
  directory: FilePath,
): Promise<HeadlessReport> {
  const assets = accepted(openAssets(directory));
  try {
    return await renderEnvironment(options, owners, await environment(options, owners, assets));
  } finally {
    accepted(assets.close());
  }
}

/** One prepared environment drives the whole render. */
async function renderEnvironment(
  options: HeadlessOptions,
  owners: HeadlessOwners,
  env: Environment,
): Promise<HeadlessReport> {
  const catalog = await themes(options, env, owners);
  const collection = await input(options, env, catalog, owners);
  const job = renderJob(options, owners, env, catalog, collection);
  const document = accepted(await owners.service.produceDiagram(job, new AbortController().signal));
  const snapshot = renderSnapshot(collection, document, catalog, env);
  const files = await output(options, snapshot, document, env, catalog);
  return renderReport(files, collection, document, catalog);
}

/** Shipped themes, then the --theme file, follow the same admission lifecycle as user files. */
async function themes(
  options: HeadlessOptions,
  env: Environment,
  owners: HeadlessOwners,
): Promise<Catalog> {
  const root = join(options.root, 'resources');
  const files = (await readdir(root)).filter((name) => name.endsWith('.theme')).sort();
  const catalog = await files.reduce(
    async (prior, name) => admitTheme(filePath.parse(join(root, name)), await prior, env, owners),
    Promise.resolve(env.installation.presets),
  );
  if (!options.themeFile) return catalog;
  return admitTheme(filePath.parse(resolve(options.themeFile)), catalog, env, owners);
}

/** Admitted theme files reuse the service preparation path and actual font asset descriptors. */
async function admitTheme(
  file: FilePath,
  catalog: Catalog,
  env: Environment,
  owners: HeadlessOwners,
): Promise<Catalog> {
  const source = accepted(owners.readTheme(await readFile(file, 'utf8')));
  const bindings = await Promise.all(
    source.resources.map(async (resource) => ({
      alias: resource.alias,
      digest: await admitResource(file, resource, env.assets, owners),
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
): Promise<StagedDigest> {
  const resource = accepted(await owners.resourceFiles.read(file, request));
  if (resource.digest !== null) return resource.digest;
  return accepted(await assets.stage(resource.stage)).descriptor.digest;
}

/** Override an ephemeral validated copy; never write or mutate the source collection or its pin. */
async function input(
  options: HeadlessOptions,
  env: Environment,
  catalog: Catalog,
  owners: HeadlessOwners,
): Promise<Collection> {
  const originalSource = await collectionSource(options, env, catalog);
  const source = await overrideSource(originalSource, options, owners, env);
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
  const theme = (await selectedTheme(options, owners, original.theme.id)) ?? original.theme.id;
  const pin = bindings.themes[theme];
  if (!pin) throw new RenderFault(headlessFault.parse({ code: 'missing-theme', theme }));
  return accepted(validate({ ...original, theme: pin }));
}

/** A recipe id, a .canvas path or a bare collection id selects the source to render. */
async function collectionSource(
  options: HeadlessOptions,
  env: Environment,
  catalog: Catalog,
): Promise<SourceFile> {
  const recipe = catalog.find(
    (preset) => preset.kind === 'recipe' && preset.id === String(options.collection),
  );
  if (recipe?.kind === 'recipe')
    return {
      source: recipe.payload.source,
      file: filePath.parse(
        join(options.root, 'resources/recipes', recipe.payload.family + '.canvas'),
      ),
    };
  if (options.collection.endsWith('.canvas'))
    return {
      source: await readFile(resolve(options.collection), 'utf8'),
      file: filePath.parse(resolve(options.collection)),
    };
  return sourceFromId(options, env);
}

/** Bare collection ids resolve from shipped semantic sources; filesystem paths stay explicit. */
async function sourceFromId(
  options: HeadlessOptions,
  env: Environment,
): Promise<SourceFile> {
  const root = join(options.root, 'resources');
  const names = (await readdir(root, { recursive: true }))
    .filter((name) => name.endsWith('.canvas'))
    .sort();
  const sources = await Promise.all(
    names.map(async (name) => ({
      source: await readFile(join(root, name), 'utf8'),
      file: filePath.parse(join(root, name)),
    })),
  );
  const matches = sources.filter((source) =>
    sourceMatches(source.source, options.collection, env.language.parse),
  );
  const [match] = matches;
  if (matches.length !== 1 || match === undefined)
    throw new RenderFault({
      code: 'collection-selection',
      id: options.collection,
      matches: matches.length,
    });
  return sourceFile.parse(match);
}

/** A file selector names the prepared theme; --theme takes precedence when both are supplied. */
async function selectedTheme(
  options: HeadlessOptions,
  owners: HeadlessOwners,
  original: Collection['theme']['id'] | null,
): Promise<Collection['theme']['id'] | null> {
  if (options.theme) return options.theme;
  if (!options.themeFile) return original;
  const parsed = accepted(owners.readTheme(await readFile(resolve(options.themeFile), 'utf8')));
  return themeSelection(parsed.admission);
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
          digest: 'sha256:' + digest,
          mediaType: blob.descriptor.mediaType,
          alt: request.alt ?? request.alias,
          ...assetAttribution(request),
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
  options: HeadlessOptions,
  owners: HeadlessOwners,
  env: Environment,
): Promise<SourceFile> {
  const selected = await selectedTheme(options, owners, null);
  if (selected === null) return source;
  return { ...source, source: sourceWithTheme(source.source, selected, env.language.parse) };
}

/** Export acquires one immutable scene and emits every section with filesystem-safe ids. */
async function output(
  options: HeadlessOptions,
  snapshot: Snapshot,
  document: RenderDocument,
  env: Environment,
  catalog: Catalog,
): Promise<HeadlessReport['files']> {
  const presentation = accepted(await createReactBindings(document.fonts));
  const exporter = composeExport({
    presentation,
    readerCss: '',
    allLabels: options.labels === true,
    snapshots: {
      acquire: async () => ({
        ok: true,
        value: { snapshot, release: async () => ({ ok: true, value: undefined }) },
      }),
    },
    documents: exportDocuments(env.language, catalog, snapshot.collection.assets),
    resources: resourceInspector(snapshot.resources),
  });
  await raster(options);
  await mkdir(options.out, { recursive: true });
  return Promise.all(
    document.scene.sections.map(async (section) =>
      exportSection(options, exporter, snapshot, section.id),
    ),
  );
}

/** Write one section's artifact to its deterministic file and return the path. */
async function exportSection(
  options: HeadlessOptions,
  exporter: ReturnType<typeof composeExport>,
  snapshot: Snapshot,
  sectionId: string,
): Promise<FilePath> {
  const artifact = accepted(
    await exporter.service.exportArtifact({
      identity: {
        collectionId: snapshot.collection.id,
        revision: snapshot.collection.revision,
      },
      format: options.format,
      scope: { kind: 'section', id: sectionId },
    }),
  );
  const file = join(options.out, sectionId.replace(/[^a-zA-Z0-9_-]/g, '-') + '.' + options.format);
  await writeFile(file, artifact.bytes);
  return filePath.parse(file);
}

/** Real raster engine initialization is needed only by PNG requests. */
async function raster(options: HeadlessOptions): Promise<void> {
  if (options.format !== 'png') return;
  const require = createRequire(join(options.root, 'capability/export/package.json'));
  accepted(
    await initializeRaster(
      await WebAssembly.compile(await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))),
    ),
  );
}
