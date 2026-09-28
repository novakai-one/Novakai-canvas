/*
 * Why this file exists
 *
 * A `.theme` file is text in Templates' own format. `theme admit my.theme` and
 * `render:png --theme-file my.theme` must both work out what theme it declares, and which fonts,
 * before anything is stored.
 *
 * This file names that one Templates step, so core can read theme text without importing
 * Templates. It reads text it is given; it never opens a file or stores a font.
 */
import type { ThemeSource, ThemeSourceFailure } from '../records/foreign.js';
import type { Result } from '../errors.js';

/** Templates' reader of `.theme` text. */
export interface ThemeReader {
  /**
   * Reads `.theme` text into the theme it declares and its body, mono and strong fonts. Fails
   * with Templates' `invalid-theme`, or `duplicate-token` (one theme setting written twice).
   */
  read(themeText: string): Result<ThemeSource, ThemeSourceFailure>;
}
