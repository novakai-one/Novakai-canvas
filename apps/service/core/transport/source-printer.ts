/*
 * Why this file exists
 *
 * The source routes answer DSL text, but the HTTP code shouldn't know the DSL's rules. For example,
 * printing the `m-review-map` section of a collection as DSL is Language's job (Language is the
 * DSL capability).
 *
 * This file builds the printer the source routes use: `describe` passes on Language's vocabulary,
 * and `print` asks Language to print a collection. If Language can't, the refusal becomes the
 * service's `invalid-input` at `source`, with Language's own failure kept inside it so the caller
 * can see why. It never changes what Language prints.
 */
import type { Language, LanguageError, Scope } from '../../contract/records/capability-types.js';
import { failure, success, type Result } from '../../contract/errors.js';

/** What the source routes need from Language: its vocabulary, and a collection printed as DSL. */
export interface SourcePrinter {
  /** Language's vocabulary, as Language answers it (its own `{ ok, value }`), sent on unchanged. */
  describe(): unknown;
  /**
   * Prints the stored collection (unchecked; Language checks it) as DSL for the scope. Answers
   * Language's printout (`source`, `collection`, `revision`, `scope`), sent on unchanged. Fails
   * with `invalid-input` at `source` when Language can't print it.
   */
  print(
    collection: unknown,
    scope: Scope,
  ): Result<unknown>;
}

/**
 * Builds the printer the source routes use, from Language. `print` fails with `invalid-input` at
 * `source` when Language refuses, with Language's failure kept inside so the caller can see why.
 */
export function createSourcePrinter(language: Pick<Language, 'describe' | 'print'>): SourcePrinter {
  return {
    describe: () => language.describe(),
    print: (collection, scope) => printCollection(language, collection, scope),
  };
}

/** Asks Language to print the collection as DSL for the scope; Language checks the collection. */
function printCollection(
  language: Pick<Language, 'print'>,
  collection: unknown,
  scope: Scope,
): Result<unknown> {
  const printed = language.print({ collection, scope });
  if (!printed.ok) {
    return languageRefusedFailure(printed.error);
  }
  return success(printed.value);
}

/** Makes the mistake for a collection Language can't print, keeping Language's own failure. */
function languageRefusedFailure(languageFailure: LanguageError): Result<never> {
  return failure(
    'invalid-input',
    'source',
    'Language could not print this collection',
    languageFailure,
  );
}
