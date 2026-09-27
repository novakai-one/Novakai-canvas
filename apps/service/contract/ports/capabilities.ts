/*
 * The capability seam: the capability behaviour service rules may call. Core cannot import a
 * capability package, so compose/capabilities.ts builds ServiceCapabilities and compose passes
 * slices of it on. Today builtin preset preparation, the workspace reader and resource selection
 * take slices; core modules in later PRs take `Pick<ServiceCapabilities, …>` of what they use.
 * Declarations only, plus the frozen empty resource set; the capabilities own their failures and
 * recovery.
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

/** Model's collection rules: validate a collection, plan a checked transition, stage one unchecked. */
export interface ModelRules {
  readonly validate: typeof validate;
  readonly plan: typeof plan;
  readonly stage: typeof stage;
}

/** Library's catalog rules: plan membership, plan organisation changes, validate a snapshot. */
export interface LibraryRules {
  readonly planMembership: typeof planMembership;
  readonly planOrganisation: typeof planOrganisation;
  readonly validateSnapshot: typeof validateLibrarySnapshot;
}

/** Export's bindings factory and its Markdown text formatter. */
export interface ExportRules {
  readonly compose: typeof composeExport;
  readonly formatMarkdown: typeof formatMarkdown;
}

/** Every capability behaviour the service uses. Built by compose/capabilities.ts. */
export interface ServiceCapabilities {
  readonly model: ModelRules;
  readonly library: LibraryRules;
  readonly export: ExportRules;
  /** Language bound to Model as its reader, planner and stage. */
  readonly language: Language;
  readonly system: DesignSystem;
  /**
   * Templates bound to one call's resolved resources and the installation's token sources. Each
   * call returns a new binding, so no alias registry is shared between requests.
   */
  templates(resources: ResolvedResources): Templates<LoweredIntent>;
}

/** No themes and no assets: the resources for catalog reads and theme admission. Frozen. */
export const EMPTY_RESOURCES: ResolvedResources = Object.freeze({
  themes: Object.freeze({}),
  assets: Object.freeze({}),
});
