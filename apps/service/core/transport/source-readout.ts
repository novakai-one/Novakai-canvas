/*
 * The source readout behind `GET /api/v1/language` and `GET /api/v1/source`: Language's
 * vocabulary and a collection printed as DSL, so HTTP never learns the diagram syntax. Pure over
 * the injected Language. The caller keeps its draft on a refused print.
 */
import type { Language, Scope } from '../../contract/records/capabilities.js';
import type { RouterBindings, WireReadout } from '../../contract/records/transport/server.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Binds the readout to Language. `describe` returns Language's vocabulary; `print` behaves as
 * `print` below, over the whole collection when no scope is given.
 */
export function createSourceReadout(
  language: Pick<Language, 'describe' | 'print'>,
): RouterBindings['source'] {
  return {
    describe: () => language.describe(),
    print: (collection, scope = { kind: 'all' }) => print(language, collection, scope),
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
): WireReadout {
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
