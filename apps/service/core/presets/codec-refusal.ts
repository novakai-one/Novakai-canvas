/*
 * How the recipe and theme codecs refuse: one Templates `invalid-input` at `preset`, with a fixed
 * message for an identity or token value that is not a Templates brand. Pure. The caller keeps the
 * source, corrects it and prepares again; Authoring owns commit.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type { TemplatesResult } from '../../contract/records/capability-types.js';

/**
 * The codec failure: `invalid-input` at `preset` with this message and the owner's failure, if
 * any.
 */
export function rejected<T>(
  message: string,
  source?: FailureSource,
): TemplatesResult<T> {
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      source,
      path: 'preset',
      message,
      recovery: 'Retain the source; correct the named preset input and prepare again.',
    },
  };
}

/**
 * The failure for an identity or token value that does not match its Templates schema:
 * `invalid-input` at `preset` ("Preset provider returned invalid identity or token data").
 */
export function invalidIdentity<T>(): TemplatesResult<T> {
  return rejected('Preset provider returned invalid identity or token data');
}
