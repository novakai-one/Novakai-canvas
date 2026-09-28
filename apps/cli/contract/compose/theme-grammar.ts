/*
 * The one `.theme` grammar the CLI reads theme files with: Templates' `readThemeSource`. Builds a
 * capability value only; reads no file. `theme admit` and render:png both bind it here.
 */
import { readThemeSource } from '@novakai/canvas-templates';
import type { ThemeGrammar } from '../ports/theme-grammar.js';

/** Templates' theme grammar as the CLI's port. Never fails. */
export function composeThemeGrammar(): ThemeGrammar {
  return { read: readThemeSource };
}
