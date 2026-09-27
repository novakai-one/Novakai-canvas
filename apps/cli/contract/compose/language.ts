/*
 * The one Language factory the CLI parses, lowers and prints DSL with, over Model's reader,
 * planner and stage, and the one way the render lowers a source as a new collection. Builds
 * capability values only; reads no file. Service commands, profile commands and the headless
 * render all build their Language here.
 */
import { createLanguage, type Result as LanguageResult } from '@novakai/canvas-language';
import { plan, stage, validate } from '@novakai/canvas-model';
import type { Collection, Language, ResolvedResources } from '../records/foreign.js';

/** A Language over Model's validation, planning and staging. Never fails. */
export function composeLanguage(): Language {
  return createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
}

/**
 * `source` lowered as a new collection against `resources`, with no snapshot. Fails with
 * Language's `validation-failed` diagnostics.
 */
export function lowerAsNew(
  language: Pick<Language, 'lower'>,
  source: string,
  resources: ResolvedResources,
): LanguageResult<Collection> {
  const lowered = language.lower({ source, mode: 'create', snapshot: null, resources });
  if (!lowered.ok) return lowered;
  return { ok: true, value: lowered.value.collection };
}
