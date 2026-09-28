/*
 * Why this file exists
 *
 * Service core needs capability rules, like Model's collection check or Library's catalog planner,
 * but it may not import a capability package. Something outside core must build them, in one place,
 * so every part uses the same ones.
 *
 * This file is that place. It builds Language, Design System, Templates (with the service's own
 * recipe and theme codecs) and Model's, Library's and Export's rules, and hands them over as one
 * `ServiceCapabilities`. Building them reads no files and starts nothing.
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
 * Builds every capability the service uses. `tokenSources` are the design token sources as read
 * from disk; Design System checks them on every call. Never fails.
 */
export function createServiceCapabilities(tokenSources: unknown): ServiceCapabilities {
  const language = createServiceLanguage();
  const system = composeDesignSystem();
  return {
    model: MODEL_RULES,
    library: LIBRARY_RULES,
    export: EXPORT_RULES,
    language,
    system,
    templates: (resources) =>
      composeTemplates(createPresetCodecs({ system, language, sources: tokenSources, resources })),
  };
}

/** Makes the recipe and theme codecs for one request's themes and files. Never fails. */
export function createPresetCodecs(context: PresetContext): PresetCodecs {
  return { recipe: createRecipeCodec(context), theme: createThemeCodec(context) };
}

/** Makes Language, using Model's rules to check, plan and stage collections. Never fails. */
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
