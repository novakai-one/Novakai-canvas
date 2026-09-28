/*
 * The `.theme` grammar theme files are read with: Templates' `readThemeSource`. Declaration only;
 * compose binds it in `compose/theme-grammar.ts`. Reading the grammar reads no file and stages no
 * font; `theme admit` and render:png read the file first and stage the fonts after.
 */
import type { ThemeSource, ThemeSourceFailure } from '../records/foreign.js';
import type { Result } from '../errors.js';

/** Templates' theme grammar. */
export interface ThemeGrammar {
  /**
   * A `.theme` file's text as its theme admission and its body, mono and strong fonts. Fails with
   * Templates' `invalid-theme` or `duplicate-token`; the first failure wins.
   */
  read(text: string): Result<ThemeSource, ThemeSourceFailure>;
}
