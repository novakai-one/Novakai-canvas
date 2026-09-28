/*
 * Why this file exists
 *
 * The source routes answer DSL text, but the HTTP code shouldn't know the DSL's rules. For example,
 * printing the `m-review-map` section of a collection as DSL is Language's job.
 *
 * This file connects the source routes to Language: `describe` passes on Language's vocabulary,
 * and `print` asks Language to print a collection. If Language can't, the refusal becomes the
 * service's `invalid-input` at `source`, with Language's own failure kept as evidence. It never
 * changes what Language prints.
 */
import type { Language, Scope } from '../../contract/records/capability-types.js';
import type { SourceReadout } from './source-routes.js';
import { failure, success, type Result } from '../../contract/errors.js';

/**
 * Builds the readout the source routes use, from Language. `print` fails with `invalid-input` at
 * `source` when Language refuses, keeping Language's failure as the `source` evidence.
 */
export function createSourceReadout(language: Pick<Language, 'describe' | 'print'>): SourceReadout {
  return {
    describe: () => language.describe(),
    print: (collection, scope) => print(language, collection, scope),
  };
}

/**
 * The collection's DSL for the scope. Language validates the collection itself. Fails with
 * `invalid-input` at `source` when Language refuses (Language's failure kept as source).
 */
function print(
  language: Pick<Language, 'print'>,
  collection: unknown,
  scope: Scope,
): Result<unknown> {
  const printed = language.print({ collection, scope });
  if (!printed.ok)
    return failure(
      'invalid-input',
      'source',
      'Language could not print this collection',
      printed.error,
    );
  return success(printed.value);
}
