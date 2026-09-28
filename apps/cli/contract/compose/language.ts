/*
 * Why this file exists
 *
 * Language reads `.canvas` text and turns it into collections, but it asks Model whether what it
 * builds is a valid collection. Service commands, profile commands and render:png all need that
 * same Language, joined to Model the same way.
 *
 * This file joins them, in one place. It builds a value only; it reads no file.
 */
import { createLanguage } from '@novakai/canvas-language';
import { plan, stage, validate } from '@novakai/canvas-model';
import type { Language } from '../records/foreign.js';

/** Makes a Language joined to Model, which checks the collections Language builds. Never fails. */
export function createLanguageWithModel(): Language {
  return createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
}
