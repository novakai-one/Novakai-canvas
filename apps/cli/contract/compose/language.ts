/*
 * The one Language factory the CLI parses, lowers and prints DSL with, over Model's reader,
 * planner and stage. Builds capability values only; reads no file. Service commands, profile
 * commands and the headless render all build their Language here.
 */
import { createLanguage } from '@novakai/canvas-language';
import { plan, stage, validate } from '@novakai/canvas-model';
import type { Language } from '../records/foreign.js';

/** A Language over Model's validation, planning and staging. Never fails. */
export function composeLanguage(): Language {
  return createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
}
