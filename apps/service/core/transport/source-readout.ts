/*
 * The source readout behind `GET /api/v1/language` and `GET /api/v1/source`: Language's
 * vocabulary and a collection printed as DSL, so HTTP never learns the diagram syntax. Pure over
 * the injected Language. The caller keeps its draft on a refused print.
 */
import type { Language } from '../../contract/records/capabilities.js';
import type { RouterBindings } from '../../contract/records/transport/server.js';
import { failure } from '../../contract/errors.js';
/**
 * Binds the readout to Language. `describe` returns Language's vocabulary. `print` returns the
 * collection's DSL for the scope (the whole collection when none is given), or fails with
 * `invalid-input` at `source` when Language refuses (Language's failure kept as source).
 */
export function createSourceReadout(
  language: Pick<Language, 'describe' | 'print'>,
): RouterBindings['source'] {
  return {
    describe: () => language.describe(),
    print: (collection, scope = { kind: 'all' }) => {
      const printed = language.print({ collection, scope });
      if (!printed.ok)
        return failure(
          'invalid-input',
          'source',
          'Language could not print this collection',
          printed.error,
        );
      return { ok: true, value: printed.value };
    },
  };
}
