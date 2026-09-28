/*
 * Why this file exists
 *
 * Some commands must understand `.canvas` text before they do anything else: `create`,
 * `replace`, `patch`, `preview`, `recipe admit` and `profile lint`. If Language can't parse the
 * text, the command stops there and shows Language's reasons. `node @a thing "A"` fails with
 * `invalid-source`, because `thing` isn't a kind of node.
 *
 * This file parses the text the same way for all of them, and keeps Language's reasons whole. It
 * never reads a file or sends anything.
 */
import type { SourceParser } from '../../contract/ports/source-parser.js';
import type { ParsedSource } from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Parses `.canvas` text with Language. `text` is the file's text as read; this is where it is
 * first checked.
 * The mistake it can find: Language can't parse the text (`invalid-source`; its `source` holds
 * Language's reasons).
 */
export function parseSource(
  language: SourceParser,
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
