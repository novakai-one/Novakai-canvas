/*
 * Why this file exists
 *
 * Service rules lean on the capabilities. For example, before a collection is saved, Model checks
 * it is valid and Library plans its place in the catalog. But service core may not import a
 * capability package.
 *
 * So compose builds the capabilities once and hands each part of core only the ones it uses, such
 * as `Pick<ServiceCapabilities, 'model' | 'library'>`. This file declares that bundle, and
 * `EMPTY_RESOURCES` for calls that use no themes or files. Each capability keeps its own mistakes.
 */
import type { DesignSystem } from '@novakai/canvas-design-system';
import type { composeExport, formatMarkdown } from '@novakai/canvas-export';
import type { Language, LoweredIntent, ResolvedResources } from '@novakai/canvas-language';
import type {
  planMembership,
  planOrganisation,
  validateLibrarySnapshot,
} from '@novakai/canvas-library';
import type { plan, stage, validate } from '@novakai/canvas-model';
import type { Templates } from '@novakai/canvas-templates';

/**
 * Model's collection rules: check a collection, plan a checked change, and stage a change (apply it
 * without the final check, as Language does while it turns DSL into changes).
 */
export interface ModelRules {
  readonly validate: typeof validate;
  readonly plan: typeof plan;
  readonly stage: typeof stage;
}

/**
 * Library's catalog rules: plan adding or removing collections, plan catalog changes (folders,
 * order), and check a whole catalog.
 */
export interface LibraryRules {
  readonly planMembership: typeof planMembership;
  readonly planOrganisation: typeof planOrganisation;
  readonly validateSnapshot: typeof validateLibrarySnapshot;
}

/**
 * Export's builder (`compose`, which makes the SVG and PNG exporter) and its Markdown formatter.
 */
export interface ExportRules {
  readonly compose: typeof composeExport;
  readonly formatMarkdown: typeof formatMarkdown;
}

/** Every capability the service uses. Built once by compose/capabilities.ts. */
export interface ServiceCapabilities {
  readonly model: ModelRules;
  readonly library: LibraryRules;
  readonly export: ExportRules;
  /** Language bound to Model as its reader, planner and stage. */
  readonly language: Language;
  /** Design System: resolves themes and design tokens. */
  readonly system: DesignSystem;
  /**
   * Makes a Templates (the theme and recipe store) that knows the themes and files one request
   * uses. Each call makes a new one, so what one request looked up is never seen by another.
   */
  templates(resources: ResolvedResources): Templates<LoweredIntent>;
}

/** No themes and no files: for catalog reads and theme saving, which use none. Frozen. */
export const EMPTY_RESOURCES: ResolvedResources = Object.freeze({
  themes: Object.freeze({}),
  assets: Object.freeze({}),
});
