/*
 * Why this file exists
 *
 * `theme admit` and render:png both read `.theme` text, and must read it the same way. Templates
 * owns that format and its reader.
 *
 * This file hands Templates' reader to both, in the shape core asks for. It builds a value only;
 * it reads no file.
 */
import { readThemeSource } from '@novakai/canvas-templates';
import type { ThemeGrammar } from '../ports/theme-grammar.js';

/** Gives back Templates' `.theme` reader as the CLI's `ThemeGrammar`. Never fails. */
export function composeThemeGrammar(): ThemeGrammar {
  return { read: readThemeSource };
}
