/*
 * The first check on source text, before any token is read: it must be a string, contain no
 * unpaired surrogate and be at most 16 MiB as UTF-8. `print` also runs this check on the source
 * it prints. No side effects. Language owns correcting the source; Authoring owns commit
 * recovery.
 */
import { reject, origin } from './outcomes.js';

/** The largest source accepted, in UTF-8 bytes (16 MiB). */
const maxSourceBytes = 16 * 1024 * 1024;

/** A high surrogate not followed by a low one, or a low surrogate not preceded by a high one. */
const unpairedSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/**
 * Checks that source text can be read. The checks run in this order: type, surrogates, size.
 *
 * @throws A `LanguageFault` at the start of the source: `invalid-input` for a non-string or an
 * unpaired surrogate, `limit` for more than 16 MiB of UTF-8.
 */
export function readSource(source: unknown): string {
  if (typeof source !== 'string')
    reject('invalid-input', origin, 'UTF8 source string', 'Source must be text');
  checkUnicode(source);
  if (new TextEncoder().encode(source).length > maxSourceBytes)
    reject(
      'limit',
      origin,
      `At most ${maxSourceBytes / 1024 / 1024}MiB UTF8`,
      'Source exceeds byte limit',
    );
  return source;
}

/** Rejects an unpaired UTF-16 surrogate, which has no faithful UTF-8 form. */
function checkUnicode(source: string): void {
  if (unpairedSurrogate.test(source))
    reject(
      'invalid-input',
      origin,
      'Paired Unicode surrogates',
      'Source contains an unpaired surrogate',
    );
}
