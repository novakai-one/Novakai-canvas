/*
 * A UTF-8 source file as read: its checked path and its text. Pure declaration. The adapter that
 * reads the file mints the path; Language checks the text later.
 */
import type { FilePath } from '../brands.js';

/** One file's text and the path it was read from. Its resources resolve against that directory. */
export interface SourceFile {
  readonly file: FilePath;
  readonly source: string;
}
