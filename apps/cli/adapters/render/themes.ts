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
import type { ThemeFont, RenderThemes } from '../../contract/ports/render-themes.js';
import { providerFailure, success, type Result } from '../../contract/errors.js';
import type {
  Assets,
  Catalog,
  HeadlessTools,
  ThemeAdmission,
} from '../../contract/records/foreign.js';

/** The parts admitting a theme uses: the shipped catalog, the render's store and Templates. */
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

/**
 * Gives core the shipped catalog, and the step that admits a `--theme-file` theme into a catalog.
 * Admitting fails when the service or Templates refuses the theme, or when a number in it is too
 * large for JSON (`provider-failed`).
 */
export function createRenderThemes(dependencies: ThemeDependencies): RenderThemes {
  return {
    catalog: dependencies.presets,
    admit: (catalog, theme, fonts) => admittedTheme(dependencies, { catalog, theme, fonts }),
  };
}

/** The service's theme preparation's answer. */
type PreparedTheme = ReturnType<HeadlessTools['prepareTheme']>;

/** One theme admission's input: the catalog, the theme and its staged fonts. */
interface ThemeInput {
  readonly catalog: Catalog;
  readonly theme: ThemeAdmission;
  readonly fonts: readonly ThemeFont[];
}

/**
 * The catalog with the theme admitted through the service's preparation and Templates' plan. A
 * value JSON cannot hold (a dimension too large to be finite) fails as `provider-failed` with the
 * JSON check's message; otherwise fails as the preparation or the plan does.
 */
function admittedTheme(
  owners: ThemeDependencies,
  input: ThemeInput,
): Result<Catalog, RenderFailureSource> {
  const admission = z.json().safeParse(input.theme);
  if (!admission.success) return providerFailure(admission.error);
  const prepared = owners.prepareTheme(admission.data, input.catalog, input.fonts, owners);
  return plannedTheme(owners, input.catalog, prepared);
}

/** The prepared theme planned into the catalog. Fails as the preparation or the plan does. */
function plannedTheme(
  owners: ThemeDependencies,
  catalog: Catalog,
  prepared: PreparedTheme,
): Result<Catalog, RenderFailureSource> {
  if (!prepared.ok) return prepared;
  const planned = owners.templates.planAdmission(catalog, prepared.value);
  if (!planned.ok) return planned;
  return success(planned.value.candidate);
}
