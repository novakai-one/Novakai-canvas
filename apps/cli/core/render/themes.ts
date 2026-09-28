/*
 * The theme catalog one render lowers against, and the theme it draws with. The installation's
 * presets come first, then every shipped `.theme` file in name order, then the --theme-file; each
 * file is read and parsed once, its fonts are staged in the render's temporary asset store, and
 * the service's theme preparation admits it. Pure apart from the injected ports; nothing stored is
 * changed. The caller fixes the named theme file or font and runs render:png again.
 */
import type { InputFiles } from '../../contract/ports/render-files.js';
import type { FontBinding, RenderThemes } from '../../contract/ports/render-themes.js';
import type { Catalog } from '../../contract/records/foreign.js';
import type { RenderChoice, ThemeChoice } from '../../contract/records/render.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type { FontRequest, ThemeSource } from '../../contract/records/theme-source.js';
import type { FilePath, PresetId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { combined, mapped } from '../shared/results.js';
import { readThemeSource } from '../themes/grammar.js';
import { admitResource, type AdmissionDependencies } from './resource-admission.js';

/** The admitted catalog and, when one is asked for, the theme drawn in place of the collection's. */
export interface AdmittedThemes {
  readonly catalog: Catalog;
  readonly choice?: ThemeChoice;
}

/** What theme admission uses: the shipped and given theme files, fonts and the admission rule. */
export interface ThemeDependencies extends AdmissionDependencies {
  readonly themes: RenderThemes;
  readonly inputFiles: Pick<InputFiles, 'shippedThemes' | 'read'>;
}

/** One theme file after admission: the grown catalog and the file's `@id`. */
interface AdmittedFile {
  readonly catalog: Catalog;
  readonly id: PresetId;
}

/** A catalog, or the evidence of the first theme that failed. */
type CatalogResult = Result<Catalog, RenderEvidence>;

/**
 * Every shipped theme, then the --theme-file, admitted into the installation's catalog; the choice
 * is --theme, else the --theme-file's `@id`, else none. Fails with `provider-failed` when a file
 * cannot be read, `invalid-theme` or `duplicate-token` from the theme grammar, a font's resource
 * or Assets failure, or the service's or Templates' admission failure.
 */
export async function admitThemes(
  request: Pick<RenderChoice, 'theme' | 'themeFile'>,
  dependencies: ThemeDependencies,
): Promise<Result<AdmittedThemes, RenderEvidence>> {
  const paths = await dependencies.inputFiles.shippedThemes();
  if (!paths.ok) return paths;
  const shipped = await admitInOrder(paths.value, dependencies);
  if (!shipped.ok) return shipped;
  return withThemeFile(request, shipped.value, dependencies);
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
): Promise<Result<AdmittedThemes, RenderEvidence>> {
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
): Promise<Result<AdmittedFile, RenderEvidence>> {
  const file = await dependencies.inputFiles.read(path);
  if (!file.ok) return file;
  const theme = readThemeSource(file.value.source);
  if (!theme.ok) return theme;
  return admitTheme(file.value.file, theme.value, catalog, dependencies);
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
): Promise<Result<AdmittedFile, RenderEvidence>> {
  const staged = await Promise.all(
    theme.fonts.map((font) => fontBinding(file, font, dependencies)),
  );
  const fonts = combined(staged);
  if (!fonts.ok) return fonts;
  const admitted = dependencies.themes.admit(catalog, theme.admission, fonts.value);
  return mapped(admitted, (grown) => ({ catalog: grown, id: theme.admission.id }));
}

/** One font's role and the digest of its staged bytes. Fails as the font's admission does. */
async function fontBinding(
  file: FilePath,
  font: FontRequest,
  dependencies: ThemeDependencies,
): Promise<Result<FontBinding, RenderEvidence>> {
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
