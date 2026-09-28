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
import type { ThemeReader } from '../ports/theme-reader.js';

/** Makes the CLI's `ThemeReader` from Templates' `.theme` reader. Never fails. */
export function createThemeReader(): ThemeReader {
  return { read: readThemeSource };
}
