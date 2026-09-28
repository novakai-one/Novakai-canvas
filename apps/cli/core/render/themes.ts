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
import { combined } from '../shared/results.js';
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
 * What admitting themes needs: theme file reads, the `.theme` reader, the font store, and
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
  const shippedPaths = await dependencies.inputFiles.shippedThemes();
  if (!shippedPaths.ok) {
    return shippedPaths;
  }
  const shippedCatalog = await admitShippedThemes(
    shippedPaths.value,
    dependencies.themes.catalog,
    dependencies,
  );
  if (!shippedCatalog.ok) {
    return shippedCatalog;
  }
  return admitThemeFileAndPickTheme(themeFlags, shippedCatalog.value, dependencies);
}

/**
 * Admits the shipped theme files one after another, each into the catalog the one before grew.
 * Stops at the first file that fails, so later files are not read.
 */
async function admitShippedThemes(
  paths: readonly FilePath[],
  catalog: Catalog,
  dependencies: ThemeDependencies,
): Promise<Result<Catalog, RenderFailureSource>> {
  const [path, ...rest] = paths;
  if (path === undefined) {
    return success(catalog);
  }
  const admitted = await admitThemeFile(path, catalog, dependencies);
  if (!admitted.ok) {
    return admitted;
  }
  return admitShippedThemes(rest, admitted.value.catalog, dependencies);
}

/**
 * Admits the `--theme-file` last, when typed, then picks the theme to draw with: `--theme`, else
 * the file's `@id`.
 */
async function admitThemeFileAndPickTheme(
  themeFlags: Pick<RenderChoice, 'theme' | 'themeFile'>,
  catalog: Catalog,
  dependencies: ThemeDependencies,
): Promise<Result<AdmittedThemes, RenderFailureSource>> {
  if (themeFlags.themeFile === undefined) {
    const themes = admittedThemes(catalog, themeFlags.theme);
    return success(themes);
  }
  const admitted = await admitThemeFile(themeFlags.themeFile, catalog, dependencies);
  if (!admitted.ok) {
    return admitted;
  }
  const choice = themeFlags.theme ?? admitted.value.id;
  const themes = admittedThemes(admitted.value.catalog, choice);
  return success(themes);
}

/** Reads and parses one `.theme` file, then admits its theme into `catalog`. */
async function admitThemeFile(
  path: FilePath,
  catalog: Catalog,
  dependencies: ThemeDependencies,
): Promise<Result<AdmittedFile, RenderFailureSource>> {
  const file = await dependencies.inputFiles.read(path);
  if (!file.ok) {
    return file;
  }
  const theme = dependencies.themeReader.read(file.value.source);
  if (!theme.ok) {
    return theme;
  }
  return admitTheme(file.value.path, theme.value, catalog, dependencies);
}

/** Stores the theme's fonts, read relative to its file, then has Templates admit the theme. */
async function admitTheme(
  file: FilePath,
  theme: ThemeSource,
  catalog: Catalog,
  dependencies: ThemeDependencies,
): Promise<Result<AdmittedFile, RenderFailureSource>> {
  const fonts = await storeThemeFonts(file, theme.fonts, dependencies);
  if (!fonts.ok) {
    return fonts;
  }
  const grown = dependencies.themes.admit(catalog, theme.admission, fonts.value);
  if (!grown.ok) {
    return grown;
  }
  return success({ catalog: grown.value, id: theme.admission.id });
}

/**
 * Stores each of a theme's fonts, all at once. Gives back each font's role and digest, or the
 * first failure in file order.
 */
async function storeThemeFonts(
  file: FilePath,
  fonts: readonly FontRequest[],
  dependencies: ThemeDependencies,
): Promise<Result<readonly ThemeFont[], RenderFailureSource>> {
  const storing = fonts.map((font) => storeThemeFont(file, font, dependencies));
  const stored = await Promise.all(storing);
  return combined(stored);
}

/** Stores one theme font, and gives back its role and the digest of its bytes. */
async function storeThemeFont(
  file: FilePath,
  font: FontRequest,
  dependencies: ThemeDependencies,
): Promise<Result<ThemeFont, RenderFailureSource>> {
  const digest = await admitResource(file, font, dependencies);
  if (!digest.ok) {
    return digest;
  }
  return success({ alias: font.alias, digest: digest.value });
}

/** Pairs the catalog with the theme to draw with. With no choice, the collection keeps its own. */
function admittedThemes(
  catalog: Catalog,
  choice: ThemeChoice | undefined,
): AdmittedThemes {
  if (choice === undefined) {
    return { catalog };
  }
  return { catalog, choice };
}
