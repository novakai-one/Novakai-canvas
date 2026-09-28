import type { Diagnostic, DiagnosticCode, Result } from '../../contract/errors.js';

/**
 * Builds zero or one diagnostic: one when `violated` is true, none otherwise. Rules use it so a
 * true condition always means "this is wrong".
 *
 * @param violated - Whether the rule is broken.
 * @param code - The failure category.
 * @param path - Where the failure is.
 * @param message - What is wrong.
 * @returns A new list with one diagnostic, or an empty list.
 * @throws Never.
 */
export function diagnoseWhen(
  violated: boolean,
  code: DiagnosticCode,
  path: string,
  message: string,
): readonly Diagnostic[] {
  if (!violated) {
    return [];
  }
  return [{ code, path, message }];
}

/**
 * Builds a `reference` diagnostic when an ID is missing: "Reference must resolve in this
 * collection and scope". Same convention as {@link diagnoseWhen}.
 *
 * @param missing - Whether the referenced ID was not found.
 * @param path - Where the reference is.
 * @returns A new list with one diagnostic, or an empty list.
 * @throws Never.
 */
export function referenceIssue(
  missing: boolean,
  path: string,
): readonly Diagnostic[] {
  return diagnoseWhen(
    missing,
    'reference',
    path,
    'Reference must resolve in this collection and scope',
  );
}

/**
 * Builds a `validation-failed` result with one diagnostic and no value. Not frozen: the public
 * Model operation that returns it freezes it. Authoring owns commit and crash recovery.
 *
 * @param code - The failure category.
 * @param path - Where the failure is.
 * @param message - What is wrong.
 * @returns A new failure.
 * @throws Never.
 */
export function failure<T>(
  code: DiagnosticCode,
  path: string,
  message: string,
): Result<T> {
  return {
    ok: false,
    error: { code: 'validation-failed', diagnostics: [{ code, path, message }] },
  };
}

/**
 * Builds a success around `value`. Not frozen: the public Model operation freezes it; Authoring
 * owns commit and recovery.
 *
 * @param value - The success value (not copied).
 * @returns A new success.
 * @throws Never.
 */
export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * Builds a `validation-failed` result from a list of diagnostics, in the same order (the list is
 * copied). Not frozen; Authoring owns commit and crash recovery. An empty list means a rule reported failure without evidence; that becomes `shape` at
 * `$`, "Validation provider rejected input without diagnostic evidence".
 *
 * @param diagnostics - The diagnostics; normally at least one.
 * @returns A new failure. Not frozen.
 * @throws Never.
 */
export function rejected<T>(diagnostics: readonly Diagnostic[]): Result<T> {
  const [first, ...remaining] = diagnostics;
  if (first === undefined) {
    return failure('shape', '$', 'Validation provider rejected input without diagnostic evidence');
  }
  return { ok: false, error: { code: 'validation-failed', diagnostics: [first, ...remaining] } };
}
