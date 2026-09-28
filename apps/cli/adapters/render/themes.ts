/*
 * Why this file exists
 *
 * `--theme-file my.theme` draws with a theme that isn't shipped. Before it can be used, the
 * service must prepare it with its fonts, and Templates must check it against the themes the
 * render already knows (the catalog). Core asks for this through `RenderThemes`.
 *
 * This file answers with the shipped catalog and that one step, "admitting" the theme. Admitting
 * gives back a bigger catalog for this render only; nothing saved changes.
 */
import { z } from 'zod';
import type { LoweredIntent } from '@novakai/canvas-language';
import type { Templates } from '@novakai/canvas-templates';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { ProviderFault } from '../../contract/records/render-fault.js';
import type { ThemeFont, RenderThemes } from '../../contract/ports/render-themes.js';
import { providerFailure, success, type Result } from '../../contract/errors.js';
import type {
  Assets,
  Catalog,
  HeadlessTools,
  ThemeAdmission,
} from '../../contract/records/foreign.js';

/** What admitting a theme needs: the shipped catalog, the render's store and Templates. */
export interface ThemeDependencies {
  /** The shipped themes and recipes. */
  readonly presets: Catalog;
  /** The render's throwaway store, where the theme's fonts are read back from. */
  readonly assets: Pick<Assets, 'resolve'>;
  /** Templates: reads the theme's base from the catalog, then checks the prepared theme fits. */
  readonly templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'>;
  /** The service's theme preparation, which admission runs before Templates plans the theme. */
  readonly prepareTheme: HeadlessTools['prepareTheme'];
}

/** One theme admission's input: the catalog, the theme and its staged fonts. */
interface ThemeInput {
  readonly catalog: Catalog;
  readonly theme: ThemeAdmission;
  readonly fonts: readonly ThemeFont[];
}

/** The theme as plain JSON, the way the service's theme preparation takes it. */
type JsonTheme = Parameters<HeadlessTools['prepareTheme']>[0];

/**
 * Gives core the shipped catalog, and the step that admits a `--theme-file` theme into a catalog.
 * Admitting fails when the service or Templates refuses the theme, or when a number in it is too
 * large for JSON (`provider-failed`).
 */
export function createRenderThemes(dependencies: ThemeDependencies): RenderThemes {
  return {
    catalog: dependencies.presets,
    admit: (catalog, theme, fonts) => admitTheme(dependencies, { catalog, theme, fonts }),
  };
}

/** Checks the theme is plain JSON, then has the service prepare it and Templates plan it in. */
function admitTheme(
  dependencies: ThemeDependencies,
  input: ThemeInput,
): Result<Catalog, RenderFailureSource> {
  const jsonTheme = checkThemeIsJson(input.theme);
  if (!jsonTheme.ok) {
    return jsonTheme;
  }
  return prepareAndPlanTheme(dependencies, input, jsonTheme.value);
}

/** Checks the theme holds only what JSON can hold; a dimension too large to be finite can't. */
function checkThemeIsJson(theme: ThemeAdmission): Result<JsonTheme, ProviderFault> {
  const checked = z.json().safeParse(theme);
  if (!checked.success) {
    return providerFailure(checked.error);
  }
  return success(checked.data);
}

/** Has the service prepare the theme with its fonts, then Templates plan it into the catalog. */
function prepareAndPlanTheme(
  dependencies: ThemeDependencies,
  input: ThemeInput,
  jsonTheme: JsonTheme,
): Result<Catalog, RenderFailureSource> {
  const prepared = dependencies.prepareTheme(jsonTheme, input.catalog, input.fonts, dependencies);
  if (!prepared.ok) {
    return prepared;
  }
  const planned = dependencies.templates.planAdmission(input.catalog, prepared.value);
  if (!planned.ok) {
    return planned;
  }
  return success(planned.value.candidate);
}
