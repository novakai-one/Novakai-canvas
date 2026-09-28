/*
 * Library's failure vocabulary and its own result envelope. Every entry point returns a failure
 * instead of throwing. Library writes nothing, so the caller recovers by correcting the named
 * input and calling again; Authoring owns commit and crash recovery.
 */

/**
 * What kind of problem a diagnostic reports. Consumers branch on this code, never on the message.
 *
 * Schema checks come first: anything a schema rejects is `invalid-input`, including a cursor that is not
 * a string or is longer than `MAX_CURSOR_LENGTH`. The other codes come from the rules checked
 * after parsing.
 *
 * - `invalid-input`: the input does not match its schema, or could not be read.
 * - `cursor-too-long`: the next page's cursor would exceed `MAX_CURSOR_LENGTH` (the only current
 *   producer).
 * - `duplicate-id`: an ID is used twice where it must be unique, whether repeated within the input
 *   or named by a create whose ID already exists.
 * - `broken-reference`: an ID refers to something that does not exist.
 * - `folder-cycle`: folder parents form a loop.
 * - `unknown-id`: an operation or query names something that does not exist.
 * - `folder-not-empty`: a folder with contents was removed without `rehome`.
 * - `invalid-cursor`: a cursor string the schema accepted is not valid cursor JSON, is from another
 *   query or snapshot, or its offset is past the results.
 */
export type DiagnosticCode =
  | 'invalid-input'
  | 'cursor-too-long'
  | 'duplicate-id'
  | 'broken-reference'
  | 'folder-cycle'
  | 'unknown-id'
  | 'folder-not-empty'
  | 'invalid-cursor';

/** One problem found in the input. */
export interface Diagnostic {
  /** The kind of problem. */
  readonly code: DiagnosticCode;
  /** Dotted path to the problem, such as `organisation.folders.<id>.parent`; `$` for the input. */
  readonly path: string;
  /** A human-readable explanation. Its wording is not part of the contract. */
  readonly message: string;
}

/** A rejection with at least one diagnostic. No partial value is returned with it. */
export interface ValidationError {
  /** Always `validation-failed`; the details are in `diagnostics`. */
  readonly code: 'validation-failed';
  /** Every problem found, in the order checked. Never empty. */
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
}

/**
 * Library's own success-or-failure envelope. `E` defaults to {@link ValidationError}; it is
 * declared here so Library does not depend on another capability's result type.
 */
export type LibraryResult<T, E = ValidationError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
