/**
 * An issue from the capability that owns diagram records, kept as it was. Templates keeps its
 * `code` and never reads meaning from its `message`.
 */
export type RecordSource = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

/** A place in source text: character offset plus line and column. */
type Position = { readonly offset: number; readonly line: number; readonly column: number };

/** An issue from the compiler (Language), including how to fix it and any record-owner issue behind it. */
type LanguageSource = {
  readonly code: string;
  /** Where the issue is in the source text. */
  readonly span: { readonly start: Position; readonly end: Position };
  /** What the issue is about. */
  readonly target: string;
  /** What the compiler expected instead. */
  readonly expected: string;
  readonly message: string;
  readonly recovery: string;
  /** The record-owner issue behind this one, if any. */
  readonly source?: RecordSource | undefined;
};

/** One issue inside a validation failure: from the record owner or from the compiler. */
type SourceIssue = RecordSource | LanguageSource;

/**
 * A validation failure with its issues. The tuple type needs at least one issue, so an empty list
 * cannot be expressed.
 */
export type ValidationSource = {
  readonly code: 'validation-failed';
  readonly diagnostics: readonly [SourceIssue, ...SourceIssue[]];
};

/**
 * An operational failure with every field its owner may report, including a nested cause and a
 * failed cleanup.
 */
export type OperationSource = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly recovery: string;
  /** The records the operation was acting on. */
  readonly targets?: readonly string[] | undefined;
  /** What the owner expected instead. */
  readonly expected?: string | undefined;
  /**
   * A correlation ID for logs. `null`: the owner reported that it has no ID. Absent or
   * `undefined`: the owner did not report the field.
   */
  readonly traceId?: string | null | undefined;
  /** The failure that caused this one. */
  readonly source?: FailureSource | undefined;
  /** A failure that happened while cleaning up after this one. */
  readonly cleanup?: OperationSource | undefined;
};

/**
 * Another capability's original failure, carried under a Templates `Diagnostic`'s `source`.
 * Templates declares these shapes itself, so it depends on no other capability's types.
 */
export type FailureSource = ValidationSource | OperationSource;
