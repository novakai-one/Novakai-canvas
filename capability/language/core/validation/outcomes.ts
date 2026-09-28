/*
 * How the compiler stops and how the public operations report it. Core code calls `reject` to
 * throw a private `LanguageFault` with one diagnostic, or `accepted` to rethrow a failed result's
 * diagnostics. `protect` wraps each public operation and several internal steps (tokenize,
 * repeat, lowering and patch steps). It returns the deep-frozen value on success, the fault's
 * diagnostics as `validation-failed`, or one `provider-failure` diagnostic for any other throw;
 * failed results are deep-frozen as well.
 * Language owns correcting the source; Authoring owns commit recovery.
 */
import {
  LanguageFault,
  type Diagnostic,
  type DiagnosticCode,
  type Result,
} from '../../contract/errors.js';
import type { Span } from '../../contract/records/syntax.js';
import { copySpan, deepFreeze } from './ownership.js';

/**
 * The empty span at the start of the source (line 1, column 1), for diagnostics with no better
 * place. It is one shared object, deep-frozen, so no diagnostic that holds it can change it.
 */
export const origin: Span = deepFreeze({
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
});

/**
 * Stops compiling with one diagnostic holding a copy of `span`. The recovery text is always
 * "Retain the source, correct the named input, then check again before applying."
 *
 * @throws A `LanguageFault` holding the diagnostic, always. `protect` turns it into a result.
 */
export function reject(
  code: DiagnosticCode,
  span: Span,
  expected: string,
  message: string,
  target = '',
): never {
  throw new LanguageFault([
    {
      code,
      span: copySpan(span),
      expected,
      message,
      target,
      recovery: 'Retain the source, correct the named input, then check again before applying.',
    },
  ]);
}

/**
 * Unwraps a result from another compiler step.
 *
 * @throws A `LanguageFault` holding every diagnostic of a failed result.
 */
export function accepted<T>(result: Result<T>): T {
  if (!result.ok) throw new LanguageFault(result.error.diagnostics);
  return result.value;
}

/**
 * Runs one operation and turns every throw into a result. On success the value is deep-frozen
 * in place (it must be a record the compiler built, never caller data); a failed result is
 * deep-frozen too. Any throw other than a `LanguageFault`, including one while freezing, becomes
 * one `provider-failure` diagnostic that shows none of the error's text.
 */
export function protect<T>(operation: () => T): Result<T> {
  try {
    const value = operation();
    deepFreeze(value);
    return { ok: true, value };
  } catch (error) {
    return faultResult(error);
  }
}

/** The failed result for a caught throw: the fault's diagnostics, or one `provider-failure`. */
function faultResult(error: unknown): Result<never> {
  if (error instanceof LanguageFault) return failed(error.diagnostics);
  return failed([
    {
      code: 'provider-failure',
      span: origin,
      target: '',
      expected: 'Readable immutable input and a successful owner result',
      message: 'Input or provider could not be read',
      recovery: 'Retain source; repair the provider or input and check again.',
    },
  ]);
}

/**
 * A deep-frozen `validation-failed` result holding the diagnostics. Every diagnostic is Language's
 * own record (spans and Model issues are copies), so freezing changes no caller's data.
 */
function failed(diagnostics: readonly [Diagnostic, ...Diagnostic[]]): Result<never> {
  return deepFreeze({ ok: false, error: { code: 'validation-failed', diagnostics } });
}
