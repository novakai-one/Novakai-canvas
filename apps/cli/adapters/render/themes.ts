/*
 * The render environment's theme rules: the installation's catalog, and theme admission through
 * the service's theme preparation and Templates' plan. Pure apart from reading the render's
 * temporary asset store; a catalog value grows and nothing stored is changed. Every method returns
 * the owner's failure as a value; core/render/render.ts owns recovery.
 */
import { z } from 'zod';
import type { LoweredIntent } from '@novakai/canvas-language';
import type { Templates } from '@novakai/canvas-templates';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type { FontBinding, RenderThemes } from '../../contract/ports/render-themes.js';
import { faulted, nativeFault, success, type Result } from '../../contract/errors.js';
import type {
  Assets,
  Catalog,
  HeadlessBindings,
  ThemeAdmission,
} from '../../contract/records/foreign.js';

/** What theme admission runs over: the installation's presets, the asset store and Templates. */
export interface ThemeOwners {
  readonly presets: Catalog;
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'read' | 'planAdmission'>;
  /** The service's theme preparation, which admission runs before Templates plans the theme. */
  readonly prepareTheme: HeadlessBindings['prepareTheme'];
}

/**
 * The theme rules over `owners`. Builds nothing and cannot fail; `admit` fails as
 * {@link admittedTheme} does.
 */
export function createRenderThemes(owners: ThemeOwners): RenderThemes {
  return {
    catalog: owners.presets,
    admit: (catalog, theme, fonts) => admittedTheme(owners, { catalog, theme, fonts }),
  };
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
  owners: ThemeOwners,
  input: ThemeInput,
): Result<Catalog, RenderEvidence> {
  const admission = z.json().safeParse(input.theme);
  if (!admission.success) return faulted(nativeFault(admission.error));
  const prepared = owners.prepareTheme(admission.data, input.catalog, input.fonts, owners);
  return plannedTheme(owners, input.catalog, prepared);
}

/** The prepared theme planned into the catalog. Fails as the preparation or the plan does. */
function plannedTheme(
  owners: ThemeOwners,
  catalog: Catalog,
  prepared: PreparedTheme,
): Result<Catalog, RenderEvidence> {
  if (!prepared.ok) return prepared;
  const planned = owners.templates.planAdmission(catalog, prepared.value);
  if (!planned.ok) return planned;
  return success(planned.value.candidate);
}
