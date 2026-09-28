/*
 * Why this file exists
 *
 * Before a source is sent anywhere, the CLI reads it to find what it needs, such as the fonts and
 * images it names. `create my-diagram.canvas` parses the text first, and a source Language can't
 * parse is refused (`invalid-source`) before anything is sent.
 *
 * This file names that one Language step, so core can parse without importing Language. Parsing
 * reads no file and sends nothing.
 */
import type { Language } from '../records/foreign.js';

/** Language's `parse`: it gives back the parsed source, or Language's findings. */
export type SourceLanguage = Pick<Language, 'parse'>;
