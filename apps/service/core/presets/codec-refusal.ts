/*
 * Why this file exists
 *
 * Templates saves themes and recipes, and asks two codecs (recipe-codec.ts, theme-codec.ts) to read
 * them. When a codec can't, Templates needs the mistake in its own form. For example, a recipe
 * whose DSL has a typo is refused as `invalid-input` at `preset`.
 *
 * This file makes that one kind of mistake for both codecs, as a Templates `Result`. The caller
 * keeps its source, fixes it and prepares again. It never throws.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type { TemplatesResult } from '../../contract/records/capability-types.js';

/**
 * Makes the codecs' mistake: `invalid-input` at `preset`, with `message`. `source` keeps the
 * failure of the capability that refused, such as Language's.
 */
export function codecFailure<T>(
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
 * Makes the mistake for an ID, version, digest or token that fails Templates' check:
 * `invalid-input` at `preset`, "Preset provider returned invalid identity or token data".
 */
export function invalidIdentityFailure<T>(): TemplatesResult<T> {
  return codecFailure('Preset provider returned invalid identity or token data');
}
