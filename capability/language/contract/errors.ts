/*
 * Language's failure vocabulary: the diagnostic codes, one diagnostic, the validation error the
 * public operations return, Language's own `Result`, and the private fault the compiler throws
 * internally before the public operations turn it into a typed result.
 */
import type { Span } from './records/syntax.js';

/** Why a source, request or owner result was rejected. */
export type DiagnosticCode =
  /** The source does not follow the grammar (a token, statement or structure is wrong). */
  | 'syntax'
  /** The source or a `describe` call asks for a language version other than 1. */
  | 'unsupported-version'
  /** The request itself is wrong, for example the mode does not match the snapshot. */
  | 'invalid-input'
  /** A property name is not part of the vocabulary for that target. */
  | 'unknown-property'
  /**
   * A value or combination is not allowed: a property value of the wrong form, a missing
   * required value such as image alt text, or an operation mix such as deleting and re-adding
   * the same section in one patch.
   */
  | 'invalid-value'
  /** A reference names a section, object or other target that does not exist. */
  | 'unknown-target'
  /** A theme or asset the source needs was not supplied. */
  | 'missing-resource'
  /**
   * A supplied theme or asset does not match what the source asks for: a theme's name or pin,
   * an asset's digest, or its alt, licence or attribution text.
   */
  | 'resource-mismatch'
  /** Model rejected the compiled collection or change; `source` keeps Model's own issue. */
  | 'domain'
  /** The source is a scoped `view` readout, which can never be applied. */
  | 'display-only'
  /** A size limit was exceeded (source bytes, tokens, statements, operations, nesting). */
  | 'limit'
  /**
   * Something other than a source or request problem stopped the operation: an input or owner
   * could not be read, an owner threw, or the parser stopped advancing. No internal error text is
   * shown.
   */
  | 'provider-failure'
  /** The collection holds something Language cannot write back as source. */
  | 'unrepresentable';

/** A Model issue as Language receives it: code, path and message, all plain strings. */
export interface OwnerDiagnostic {
  /** Model's issue code. */
  readonly code: string;

  /** Model's path to the offending record or field. */
  readonly path: string;

  /** Model's message. */
  readonly message: string;
}

/** One actionable problem, located in the source. */
export interface Diagnostic {
  /** What kind of problem it is. */
  readonly code: DiagnosticCode;

  /**
   * Where in the source it is. When there is no narrower place, this is the enclosing
   * document or operation, or the start of the source.
   */
  readonly span: Span;

  /** The ID or path the problem is about; empty when there is none. */
  readonly target: string;

  /** What was expected instead. */
  readonly expected: string;

  /** What went wrong. */
  readonly message: string;

  /** What the author should do next. */
  readonly recovery: string;

  /** For a `domain` diagnostic: Model's original issue, kept after the span is translated. */
  readonly source?: OwnerDiagnostic;
}

/** The failure every public Language operation returns: at least one diagnostic, no value. */
export interface ValidationError {
  /** Always `validation-failed`. */
  readonly code: 'validation-failed';

  /** The diagnostics, in the order they were found; never empty. */
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
}

/**
 * Language's success-or-failure value: `{ ok: true, value }` or `{ ok: false, error }`. It is
 * declared here rather than shared with other capabilities; `E` defaults to `ValidationError`.
 */
export type Result<T, E = ValidationError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * The compiler's internal rejection. Core code throws it to stop compiling; every public
 * Language operation catches it and returns its diagnostics as a `validation-failed` result. It
 * is not exported from the contract index, so callers of the public operations never see it.
 */
export class LanguageFault extends Error {
  /** Creates the fault with the message "Language rejected input". */
  constructor(readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]]) {
    super('Language rejected input');
  }
}
