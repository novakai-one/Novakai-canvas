/*
 * Why this file exists
 *
 * Language reads `.canvas` text and turns it into collections, but it needs Model to check,
 * plan and stage what it builds. Service commands, profile commands and render:png all need that
 * same Language, joined to Model the same way.
 *
 * This file joins them, in one place. It builds a value only; it reads no file.
 */
import { createLanguage } from '@novakai/canvas-language';
import { plan, stage, validate } from '@novakai/canvas-model';
import type { Language } from '../records/foreign.js';

/** Makes a Language that uses Model to check, plan and stage collections. Never fails. */
export function composeLanguage(): Language {
  return createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
}
