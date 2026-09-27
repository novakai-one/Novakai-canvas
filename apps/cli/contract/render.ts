/*
 * Render-time capability wiring for the headless boundary: the factories that compose real
 * capability values — Model digests and validation, Language, Templates admission, the service
 * installation — into the environment one render consumes. Capability values live here because
 * app core never imports capabilities; the pure render rules stay in core/render behind
 * contract/api.js.
 */
import { join } from 'node:path';
import { digest, plan, stage, validate } from '@novakai/canvas-model';
import { createLanguage, type LoweredIntent } from '@novakai/canvas-language';
import {
  prepareInstallation,
  type BuiltinResources,
  type RenderingJob,
} from '@novakai/canvas-service';
import { composeDesignSystem, type DesignSystem } from '@novakai/canvas-design-system';
import { composeTemplates, themeInput, type Templates } from '@novakai/canvas-templates';
import { validateLibrarySnapshot, type LibrarySnapshot } from '@novakai/canvas-library';
import type { Snapshot } from '@novakai/canvas-export';
import { RenderFault, accepted, retainedResources } from './api.js';
import type { HeadlessOptions, HeadlessOwners } from './records/headless.js';
import type {
  Assets,
  Catalog,
  Collection,
  Documents,
  Language,
  RenderDocument,
  ResolvedResources,
} from './records/render.js';

/** The prepared capability environment of one render. */
export interface Environment {
  readonly assets: Pick<Assets, 'stage' | 'resolve'>;
  readonly installation: BuiltinResources;
  readonly system: Pick<DesignSystem, 'resolve' | 'resolveTheme' | 'projectDiagram'>;
  readonly language: Language;
  readonly templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'>;
}

/** Theme pins from the admitted catalog plus the collection's own assets. */
export function pinResources(
  catalog: Catalog,
  assets: Collection['assets'] = [],
): ResolvedResources {
  return {
    themes: Object.fromEntries(
      catalog
        .filter((preset) => preset.kind === 'theme')
        .map((preset) => [
          preset.id,
          {
            id: preset.id,
            version: preset.version,
            digest: digest.parse('sha256:' + preset.digest),
            roles: preset.payload.roles,
          },
        ]),
    ),
    assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
  };
}

/** The theme id of a validated admission envelope; an invalid envelope terminates the render. */
export function themeSelection(admission: unknown): Collection['theme']['id'] {
  const input = themeInput.safeParse(admission);
  if (!input.success)
    throw new RenderFault({
      code: 'invalid-theme',
      message: 'Invalid theme admission envelope',
      recovery: 'Correct the theme file and retry.',
    });
  return input.data.id;
}

/** The documents port Export reads, prints and parses through for one render. */
export function exportDocuments(
  language: Pick<Language, 'lower' | 'print'>,
  catalog: Catalog,
  assets: Collection['assets'],
): Documents {
  return {
    read: (value) => ({ ok: true, value: accepted(validate(value)) }),
    print: (collection) => ({
      ok: true,
      value: accepted(language.print({ collection, scope: { kind: 'all' } })).source,
    }),
    parse: (source) => ({
      ok: true,
      value: accepted(
        language.lower({
          source,
          mode: 'create',
          snapshot: null,
          resources: pinResources(catalog, assets),
        }),
      ).collection,
    }),
  };
}

/** One prepared language and token environment drives every section render of one render. */
export async function environment(
  options: HeadlessOptions,
  owners: HeadlessOwners,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<Environment> {
  const installation = accepted(
    await prepareInstallation(
      join(options.root, 'resources'),
      join(options.root, 'capability/design-system'),
      assets,
    ),
  );
  const system: Pick<DesignSystem, 'resolve' | 'resolveTheme' | 'projectDiagram'> =
    composeDesignSystem();
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'> = composeTemplates(
    owners.service.createPresetCodecs({
      system,
      language,
      sources: installation.tokens,
      resources: { themes: {}, assets: {} },
    }),
  );
  return { assets, installation, system, language, templates };
}

/** The render job over one collection, the admitted catalog and an empty headless library. */
export function renderJob(
  options: HeadlessOptions,
  owners: HeadlessOwners,
  env: Environment,
  catalog: Catalog,
  collection: Collection,
): RenderingJob {
  const jobs = owners.service.createRenderJobs({
    ...env,
    sources: env.installation.tokens,
    wasmResource: join(options.root, 'resources/vendor/layout/libavoid.wasm'),
  });
  return accepted(
    jobs.create(
      collection,
      { collections: [collection], presets: catalog, library: headlessLibrary() },
      null,
      'headless',
    ),
  );
}

/** The immutable export snapshot: identity, collection, scene and every retained resource. */
export function renderSnapshot(
  collection: Collection,
  document: RenderDocument,
  catalog: Catalog,
  env: Environment,
): Snapshot {
  return {
    identity: {
      collectionId: collection.id,
      revision: collection.revision,
      inputKey: document.scene.inputKey,
      title: collection.title,
    },
    collection,
    scene: document.scene,
    resources: retainedResources(document, catalog, collection, env.assets.resolve),
    paint: {
      fill: document.style.surface,
      stroke: document.style.border,
      text: document.style.text,
    },
  };
}

/** The empty library snapshot headless renders run against. */
function headlessLibrary(): LibrarySnapshot {
  return accepted(
    validateLibrarySnapshot({
      organisation: {
        schemaVersion: 1,
        id: 'headless',
        revision: 0,
        folders: [],
        entries: [],
      },
      collections: [],
      recent: [],
    }),
  );
}
