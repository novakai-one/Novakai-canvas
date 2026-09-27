import type { Language } from '../../contract/records/capabilities.js';
import type { RouterBindings } from '../../contract/records/transport/server.js';
import { failure } from '../../contract/errors.js';
/** Readout translation keeps language diagnostics readable without teaching HTTP the diagram syntax. */
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
