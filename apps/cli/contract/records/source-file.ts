/*
 * Why this file exists
 *
 * render:png draws from `.canvas` files: `--collection walk.canvas`, or the collections that ship
 * with the repo. It reads each file's text before Language parses it. The path has to stay with
 * the text, because a font or image the source names, such as `assets/logo.png`, is found next to
 * that file.
 *
 * This file names that pair: the path and the text. It declares one type only; the text isn't
 * checked here.
 */
import type { FilePath } from '../brands.js';

/** One source file's text, not checked yet, and the path it was read from. */
export interface SourceFile {
  readonly path: FilePath;
  readonly source: string;
}
