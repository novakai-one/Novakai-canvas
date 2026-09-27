/*
 * Render-time capability wiring for the headless boundary: the factories that compose real
 * capability values (Model validation, Language, Templates admission, the service installation)
 * into the environment one render consumes, and the RenderEnvironment port the render rules in
 * core/render call through contract/api.js. Capability values live here because app core never
 * imports capabilities. Set-up steps throw RenderAbort through accepted(); the port returns every
 * failure as a value. The headless adapter converts both and owns recovery.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { validate } from '@novakai/canvas-model';
import type { LoweredIntent } from '@novakai/canvas-language';
import {
  prepareInstallation,
  type BuiltinResources,
  type RenderingJob,
} from '@novakai/canvas-service';
import { composeDesignSystem, type DesignSystem } from '@novakai/canvas-design-system';
import { composeTemplates, type Templates } from '@novakai/canvas-templates';
import { validateLibrarySnapshot, type LibrarySnapshot } from '@novakai/canvas-library';
import { accepted, pinResources } from './api.js';
import { composeLanguage } from './compose/language.js';
import type { RenderRequest } from './records/render.js';
import { nativeFault, type RenderEvidence } from './records/render-failure.js';
import type { ThemeAdmission } from './records/theme-source.js';
import type { FontBinding, HeadlessOwners, RenderEnvironment } from './ports/render.js';
import type { AssetDigest } from './brands.js';
import { success, type Result } from './errors.js';
import type {
  Assets,
  Catalog,
  Collection,
  Documents,
  HeadlessBindings,
  Language,
  ResolvedResources,
  StageInput,
} from './records/foreign.js';

/** The prepared capability environment of one render. */
export interface Environment {
  readonly assets: Pick<Assets, 'stage' | 'resolve'>;
  readonly installation: BuiltinResources;
  readonly system: Pick<DesignSystem, 'resolve' | 'resolveTheme' | 'projectDiagram'>;
  readonly language: Language;
  readonly templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'>;
}

/** One prepared language and token environment drives every section render of one render. */
export async function environment(
  request: RenderRequest,
  owners: HeadlessOwners,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<Environment> {
  const installation = accepted(
    await prepareInstallation(
      join(request.root, 'resources'),
      join(request.root, 'capability/design-system'),
      assets,
    ),
  );
  const system: Pick<DesignSystem, 'resolve' | 'resolveTheme' | 'projectDiagram'> =
    composeDesignSystem();
  const language = composeLanguage();
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

/**
 * The port the render rules call, over one prepared environment and the service's theme
 * preparation. Every method returns the owner's failure as a value.
 */
export function renderEnvironment(
  env: Environment,
  service: HeadlessBindings,
): RenderEnvironment {
  return {
    catalog: env.installation.presets,
    parse: (source) => env.language.parse(source),
    lower: (source, resources) => loweredCollection(env.language, source, resources),
    validate: (value) => validate(value),
    stageAsset: (input) => stagedDigest(env.assets, input),
    resolveAsset: (digest) => env.assets.resolve(digest),
    admitTheme: (catalog, theme, fonts) => admittedTheme(env, service, { catalog, theme, fonts }),
    decodeBase64: (text) => Buffer.from(text, 'base64'),
  };
}

/** The render job over one collection, the admitted catalog and an empty headless library. */
export function renderJob(
  request: RenderRequest,
  owners: HeadlessOwners,
  env: Environment,
  catalog: Catalog,
  collection: Collection,
): RenderingJob {
  const jobs = owners.service.createRenderJobs({
    ...env,
    sources: env.installation.tokens,
    wasmResource: join(request.root, 'resources/vendor/layout/libavoid.wasm'),
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

/** `source` lowered as a new collection against `resources`. Fails with Language's diagnostics. */
function loweredCollection(
  language: Language,
  source: string,
  resources: ResolvedResources,
): Result<Collection, RenderEvidence> {
  const lowered = language.lower({ source, mode: 'create', snapshot: null, resources });
  if (!lowered.ok) return lowered;
  return success(lowered.value.collection);
}

/** The digest Assets stored `input`'s normalized bytes under. Fails with Assets' failure. */
async function stagedDigest(
  assets: Environment['assets'],
  input: StageInput,
): Promise<Result<AssetDigest, RenderEvidence>> {
  const admitted = await assets.stage(input);
  if (!admitted.ok) return admitted;
  return success(admitted.value.descriptor.digest);
}

/** The service's theme preparation's answer. */
type PreparedTheme = ReturnType<HeadlessBindings['prepareTheme']>;

/** One theme admission's input: the catalog, the theme and its staged fonts. */
interface ThemeInput {
  readonly catalog: Catalog;
  readonly theme: ThemeAdmission;
  readonly fonts: readonly FontBinding[];
}

/**
 * The catalog with the theme admitted through the service's preparation and Templates' plan. A
 * value JSON cannot hold (a dimension too large to be finite) fails as `provider-failed` with the
 * JSON check's message; otherwise fails as the preparation or the plan does.
 */
function admittedTheme(
  env: Environment,
  service: HeadlessBindings,
  input: ThemeInput,
): Result<Catalog, RenderEvidence> {
  const admission = z.json().safeParse(input.theme);
  if (!admission.success) return { ok: false, error: nativeFault(admission.error) };
  const prepared = service.prepareTheme(admission.data, input.catalog, input.fonts, env);
  return plannedTheme(env, input.catalog, prepared);
}

/** The prepared theme planned into the catalog. Fails as the preparation or the plan does. */
function plannedTheme(
  env: Environment,
  catalog: Catalog,
  prepared: PreparedTheme,
): Result<Catalog, RenderEvidence> {
  if (!prepared.ok) return prepared;
  const planned = env.templates.planAdmission(catalog, prepared.value);
  if (!planned.ok) return planned;
  return success(planned.value.candidate);
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
