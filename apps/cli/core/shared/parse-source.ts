/*
 * Parsing one DSL source through the injected Language, for DSL changes, recipe admission and
 * profile lint. Pure apart from the parser. Language's diagnostics are kept whole under
 * `invalid-source`; the caller fixes the source and runs the command again.
 */
import type { SourceLanguage } from '../../contract/ports/source-language.js';
import type { ParsedSource } from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** The parsed source. Fails with `invalid-source`; `source` holds Language's diagnostics. */
export function parseSource(
  language: SourceLanguage,
  text: string,
): Result<ParsedSource> {
  const parsed = language.parse(text);
  if (!parsed.ok)
    return failure({
      code: 'invalid-source',
      message: 'Language rejected this source',
      recovery: 'Correct the named source diagnostics and retry.',
      source: parsed.error,
    });
  return success(parsed.value);
}
