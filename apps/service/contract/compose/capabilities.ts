/*
 * The one construction site for Language, Design System, the Templates factory and the Model,
 * Library and Export rule tables. Templates is composed from the core recipe and theme codecs,
 * bound here (headless.ts shares the binding). installation.ts and wiring.ts each call
 * `createServiceCapabilities` once; serve.ts builds only Language here. Core reaches these only
 * through ServiceCapabilities; adapters import capability schemas and runtimes (render worker, PNG
 * runtime, shipped resources) directly. Constructing starts no I/O; each capability owns its own
 * failures and recovery.
 */
import { composeDesignSystem } from '@novakai/canvas-design-system';
import { composeExport, formatMarkdown } from '@novakai/canvas-export';
import { createLanguage, type Language } from '@novakai/canvas-language';
import { planMembership, planOrganisation, validateLibrarySnapshot } from '@novakai/canvas-library';
import { plan, stage, validate } from '@novakai/canvas-model';
import { composeTemplates } from '@novakai/canvas-templates';
import type {
  ExportRules,
  LibraryRules,
  ModelRules,
  ServiceCapabilities,
} from '../ports/capabilities.js';
import type { PresetCodecs, PresetContext } from '../records/presets/codecs.js';
import { createRecipeCodec } from '../../core/presets/recipe-codec.js';
import { createThemeCodec } from '../../core/presets/theme-codec.js';

/**
 * Binds every capability the service uses. `sources` is the installation's raw token source
 * envelope; Design System revalidates it on every call. Each `templates(resources)` call composes
 * Templates from new preset codecs bound to those resources. Never fails.
 */
export function createServiceCapabilities(sources: unknown): ServiceCapabilities {
  const language = createServiceLanguage();
  const system = composeDesignSystem();
  return {
    model: MODEL_RULES,
    library: LIBRARY_RULES,
    export: EXPORT_RULES,
    language,
    system,
    templates: (resources) =>
      composeTemplates(createPresetCodecs({ system, language, sources, resources })),
  };
}

/** Binds the recipe and theme codecs to one preset context. Never fails. */
export function createPresetCodecs(context: PresetContext): PresetCodecs {
  return { recipe: createRecipeCodec(context), theme: createThemeCodec(context) };
}

/** Binds Language to Model as its reader, planner and stage. Never fails. */
export function createServiceLanguage(): Language {
  return createLanguage({
    reader: { validate: MODEL_RULES.validate },
    planner: { plan: MODEL_RULES.plan },
    stage: { stage: MODEL_RULES.stage },
  });
}

/** Model's collection rules. Frozen. */
const MODEL_RULES: ModelRules = Object.freeze({ validate, plan, stage });

/** Library's catalog rules. Frozen. */
const LIBRARY_RULES: LibraryRules = Object.freeze({
  planMembership,
  planOrganisation,
  validateSnapshot: validateLibrarySnapshot,
});

/** Export's bindings factory and Markdown formatter. Frozen. */
const EXPORT_RULES: ExportRules = Object.freeze({ compose: composeExport, formatMarkdown });
