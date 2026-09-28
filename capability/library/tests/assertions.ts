/*
 * Library test assertions over the public `Result` and schema checks. They read results only and
 * never change them. A failing assertion changes nothing; correct the code or the test and rerun.
 */
import { assert } from 'vitest';
import type { LibraryResult, DiagnosticCode } from '../contract/index.js';

/**
 * Asserts a result succeeded and returns its value.
 *
 * The result is turned into JSON before the assertion runs, even on success, so it throws for a
 * value JSON cannot hold (a bigint, a cycle, or a `toJSON` that throws).
 *
 * @throws Vitest's assertion error, carrying the result as JSON, when the result failed.
 *
 * @throws `TypeError` (or the `toJSON` error) when the result cannot be turned into JSON.
 */
export function valueOf<T>(result: LibraryResult<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

/**
 * True when the result failed with a diagnostic of `code` at exactly `path`. Other diagnostics in
 * the same failure are allowed.
 */
export function hasFailure<T>(
  result: LibraryResult<T>,
  code: DiagnosticCode,
  path: string,
): boolean {
  if (result.ok) {
    return false;
  }
  return result.error.diagnostics.some(
    (diagnostic) => diagnostic.code === code && diagnostic.path === path,
  );
}

/** Every diagnostic of a failed result as `code path` lines, in the order Library reported them. */
export function diagnosticsOf<T>(result: LibraryResult<T>): readonly string[] {
  if (result.ok) {
    return [];
  }
  return result.error.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.path}`);
}

/**
 * True when the value and every object or array it holds are frozen. Primitives count as frozen.
 *
 * @throws `RangeError` for a structure deeper than the call stack allows (results are shallow).
 */
export function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return true;
  }
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

/** What a schema check returns, as far as {@link issueCodes} reads it. */
interface SchemaOutcome {
  readonly error?: { readonly issues: readonly { readonly code: string }[] } | undefined;
}

/** The issue codes of a schema check, in the order the schema reported them. */
export function issueCodes(outcome: SchemaOutcome): readonly string[] {
  const issues = outcome.error?.issues ?? [];
  return issues.map((issue) => issue.code);
}
