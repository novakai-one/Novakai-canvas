/*
 * The one place the service binds concrete capabilities: Language, Design System, the Templates
 * factory and the Model, Library and Export rules. Wiring only; constructing them starts no I/O.
 * Each capability owns its own failures and recovery.
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

/** Builds the recipe and theme codecs Templates admits presets with, for one preset context. */
export type PresetCodecFactory = (context: PresetContext) => PresetCodecs;

/**
 * Binds every capability the service uses. `sources` is the installation's raw token source
 * envelope; Design System revalidates it on every call. `codecs` builds the preset codecs each
 * `templates(resources)` call composes Templates from. Never fails.
 */
export function createServiceCapabilities(
  sources: unknown,
  codecs: PresetCodecFactory,
): ServiceCapabilities {
  const language = createServiceLanguage();
  const system = composeDesignSystem();
  return {
    model: MODEL_RULES,
    library: LIBRARY_RULES,
    export: EXPORT_RULES,
    language,
    system,
    templates: (resources) => composeTemplates(codecs({ system, language, sources, resources })),
  };
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
