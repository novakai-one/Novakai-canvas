/*
 * The collection one render draws: the chosen source with the chosen theme written in, its images
 * staged, lowered against the admitted catalog's pins and checked by Model, with the chosen theme's
 * pin in place of the collection's own. A fresh copy: no stored collection or source file changes.
 * Pure apart from the injected ports. The caller names another collection or theme and runs
 * render:png again.
 */
import type { RenderEnvironment } from '../../contract/ports/render.js';
import type { Collection, ResolvedResources } from '../../contract/records/foreign.js';
import type { CollectionSelector, ThemeChoice } from '../../contract/records/render.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import { faulted } from '../../contract/records/render-failure.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { collectionSource, type SourceDependencies } from './collection-source.js';
import { pinResources } from './pins.js';
import { sourceAssets, type AssetDependencies } from './source-assets.js';
import { withTheme } from './source-theme.js';
import type { AdmittedThemes } from './themes.js';

/** What drawing a collection uses: source reads, the parse, asset admission, lowering and Model. */
export interface CollectionDependencies extends SourceDependencies, AssetDependencies {
  readonly env: Pick<
    RenderEnvironment,
    'parse' | 'lower' | 'validate' | 'stageAsset' | 'resolveAsset'
  >;
}

/**
 * The checked collection `selector` names, drawn with `themes`' choice when there is one. Fails as
 * choosing the source, overriding its theme, admitting its images, Language's lowering or Model's
 * check does, or with `missing-theme` when the choice has no admitted pin.
 */
export async function renderCollection(
  selector: CollectionSelector,
  themes: AdmittedThemes,
  dependencies: CollectionDependencies,
): Promise<Result<Collection, RenderEvidence>> {
  const original = await collectionSource(selector, themes.catalog, dependencies);
  if (!original.ok) return original;
  const source = themedSource(original.value, themes.choice, dependencies.env.parse);
  if (!source.ok) return source;
  return lowered(source.value, themes, dependencies);
}

/** The source as it is without a choice; otherwise a copy naming the chosen theme. */
function themedSource(
  source: SourceFile,
  choice: ThemeChoice | undefined,
  parse: RenderEnvironment['parse'],
): Result<SourceFile, RenderEvidence> {
  if (choice === undefined) return success(source);
  return withTheme(source, choice, parse);
}

/**
 * The source's images admitted, then the source lowered against the catalog's theme pins and those
 * assets, then checked with the chosen pin. Fails as each step does.
 */
async function lowered(
  source: SourceFile,
  themes: AdmittedThemes,
  dependencies: CollectionDependencies,
): Promise<Result<Collection, RenderEvidence>> {
  const assets = await sourceAssets(source, themes.catalog, dependencies);
  if (!assets.ok) return assets;
  const pins = pinResources(themes.catalog, assets.value);
  const collection = dependencies.env.lower(source.source, pins);
  if (!collection.ok) return collection;
  return withChoice(collection.value, pins, themes.choice, dependencies.env);
}

/**
 * Model's check of the lowered collection, with the chosen theme's pin in place of its own when
 * there is a choice. Fails with `missing-theme` or Model's diagnostics.
 */
function withChoice(
  collection: Collection,
  pins: ResolvedResources,
  choice: ThemeChoice | undefined,
  env: Pick<RenderEnvironment, 'validate'>,
): Result<Collection, RenderEvidence> {
  if (choice === undefined) return env.validate(collection);
  const pin = pins.themes[choice];
  if (pin === undefined) return faulted({ code: 'missing-theme', theme: choice });
  return env.validate({ ...collection, theme: pin });
}
