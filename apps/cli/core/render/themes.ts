/*
 * Why this file exists
 *
 * A render can only draw with themes it knows: those the service comes with, every `.theme` file in
 * the repo's `resources/` folder, and the one `--theme-file brand.theme` names. Each file's fonts
 * must be stored before Templates accepts the theme. Templates calls accepting it "admitting" it.
 *
 * This file reads each theme file, stores its fonts, admits the theme into this render's list of
 * themes (the catalog), and picks the theme to draw with. Each step gives back a `Result` (see
 * `contract/errors.ts`). Nothing saved changes; the catalog lasts for this render only.
 */
import type { InputFiles } from '../../contract/ports/render-files.js';
import type { ThemeFont, RenderThemes } from '../../contract/ports/render-themes.js';
import type { ThemeReader } from '../../contract/ports/theme-reader.js';
import type { Catalog, FontRequest, ThemeSource } from '../../contract/records/foreign.js';
import type { RenderChoice, ThemeChoice } from '../../contract/records/render.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { FilePath, PresetId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { combined, mapped } from '../shared/results.js';
import { admitResource, type AdmissionDependencies } from './resource-admission.js';

/**
 * The themes this render knows (`catalog`), and the theme to draw with in place of the
 * collection's own (`choice`). `choice` is left out when no theme was asked for.
 */
export interface AdmittedThemes {
  readonly catalog: Catalog;
  readonly choice?: ThemeChoice;
}

/**
 * The parts admitting themes uses: theme file reads, the `.theme` reader, the font store, and
 * `themes` (the catalog the service comes with, and the admission step).
 */
export interface ThemeDependencies extends AdmissionDependencies {
  readonly themes: RenderThemes;
  readonly themeReader: ThemeReader;
  readonly inputFiles: Pick<InputFiles, 'shippedThemes' | 'read'>;
}

/** One theme file after admission: the grown catalog and the file's `@id`. */
interface AdmittedFile {
  readonly catalog: Catalog;
  readonly id: PresetId;
}

/** A catalog, or the evidence of the first theme that failed. */
type CatalogResult = Result<Catalog, RenderFailureSource>;

/**
 * Admits every repo theme and the `--theme-file`, if typed, then picks the theme to draw with.
 * The pick is `--theme`, else the `--theme-file`'s `@id`, else none (the collection keeps its own).
 * Mistakes: a theme file that can't be read or parsed, a font that can't be stored, or the service
 * or Templates refusing a theme.
 */
export async function admitThemes(
  themeFlags: Pick<RenderChoice, 'theme' | 'themeFile'>,
  dependencies: ThemeDependencies,
): Promise<Result<AdmittedThemes, RenderFailureSource>> {
  const paths = await dependencies.inputFiles.shippedThemes();
  if (!paths.ok) return paths;
  const shipped = await admitInOrder(paths.value, dependencies);
  if (!shipped.ok) return shipped;
  return withThemeFile(themeFlags, shipped.value, dependencies);
}

/** The shipped theme files admitted one after another, each into the catalog before it. */
function admitInOrder(
  paths: readonly FilePath[],
  dependencies: ThemeDependencies,
): Promise<CatalogResult> {
  return paths.reduce<Promise<CatalogResult>>(
    async (prior, path) => admitAfter(await prior, path, dependencies),
    Promise.resolve(success(dependencies.themes.catalog)),
  );
}

/** `path` admitted into the prior catalog; a prior failure is kept and nothing more is read. */
async function admitAfter(
  prior: CatalogResult,
  path: FilePath,
  dependencies: ThemeDependencies,
): Promise<CatalogResult> {
  if (!prior.ok) return prior;
  return mapped(await admitThemeFile(path, prior.value, dependencies), (file) => file.catalog);
}

/**
 * The --theme-file admitted last, when given; the choice is --theme, else the file's `@id`. Fails
 * as {@link admitThemeFile} does.
 */
async function withThemeFile(
  request: Pick<RenderChoice, 'theme' | 'themeFile'>,
  catalog: Catalog,
  dependencies: ThemeDependencies,
): Promise<Result<AdmittedThemes, RenderFailureSource>> {
  if (request.themeFile === undefined) return success(chosen(catalog, request.theme));
  const admitted = await admitThemeFile(request.themeFile, catalog, dependencies);
  return mapped(admitted, (file) => chosen(file.catalog, request.theme ?? file.id));
}

/**
 * One theme file read, parsed and admitted into `catalog`. Fails with `provider-failed`, the
 * grammar's failure, or as {@link admitTheme} does.
 */
async function admitThemeFile(
  path: FilePath,
  catalog: Catalog,
  dependencies: ThemeDependencies,
): Promise<Result<AdmittedFile, RenderFailureSource>> {
  const file = await dependencies.inputFiles.read(path);
  if (!file.ok) return file;
  const theme = dependencies.themeReader.read(file.value.source);
  if (!theme.ok) return theme;
  return admitTheme(file.value.path, theme.value, catalog, dependencies);
}

/**
 * The theme's fonts, read relative to `file` and staged, then the theme admitted over them. Fails
 * with the first failed font in file order, or the admission failure.
 */
async function admitTheme(
  file: FilePath,
  theme: ThemeSource,
  catalog: Catalog,
  dependencies: ThemeDependencies,
): Promise<Result<AdmittedFile, RenderFailureSource>> {
  const staged = await Promise.all(
    theme.fonts.map((font) => stagedThemeFont(file, font, dependencies)),
  );
  const fonts = combined(staged);
  if (!fonts.ok) return fonts;
  const admitted = dependencies.themes.admit(catalog, theme.admission, fonts.value);
  return mapped(admitted, (grown) => ({ catalog: grown, id: theme.admission.id }));
}

/** One font's role and the digest of its staged bytes. Fails as the font's admission does. */
async function stagedThemeFont(
  file: FilePath,
  font: FontRequest,
  dependencies: ThemeDependencies,
): Promise<Result<ThemeFont, RenderFailureSource>> {
  const digest = await admitResource(file, font, dependencies);
  return mapped(digest, (admitted) => ({ alias: font.alias, digest: admitted }));
}

/** The catalog with the choice, when there is one; an absent choice stays absent. */
function chosen(
  catalog: Catalog,
  choice: ThemeChoice | undefined,
): AdmittedThemes {
  if (choice === undefined) return { catalog };
  return { catalog, choice };
}
