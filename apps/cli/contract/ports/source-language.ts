/*
 * The Language parser DSL sources are read with: a change's collection and resource declarations,
 * a recipe's declarations and a profile lint's document. Declaration only; compose binds the one
 * Language from `compose/language.ts`. Parsing reads no file and sends nothing.
 */
import type { Language } from '../records/foreign.js';

/** Language's `parse`: the parsed source, or Language's `validation-failed` diagnostics. */
export type SourceLanguage = Pick<Language, 'parse'>;
