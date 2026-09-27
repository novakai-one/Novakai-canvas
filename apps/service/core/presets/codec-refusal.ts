/*
 * How the recipe and theme codecs refuse: one Templates `invalid-input` at `preset`, and a guard
 * that turns a throw inside a codec into that refusal. Pure. The caller keeps the source,
 * corrects it and prepares again; Authoring owns commit.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type { TemplatesResult } from '../../contract/records/capabilities.js';

/**
 * The operation's result, or `invalid-input` at `preset` ("Preset provider returned invalid
 * identity or token data") when it throws.
 */
export function guarded<T>(operation: () => TemplatesResult<T>): TemplatesResult<T> {
  try {
    return operation();
  } catch {
    return rejected('Preset provider returned invalid identity or token data');
  }
}

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
