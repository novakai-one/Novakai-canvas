/*
 * A CLI failure as terminal lines. Pure and display-only: the Result stays structured for
 * machine consumers, and nothing parses these lines back.
 */
import type { CliFailure, LocalFailure } from '../../contract/errors.js';
import type { FailureSource, OperationSource } from '../../contract/records/foreign.js';

/** A validation batch: the evidence that is not an operation failure. */
type ValidationSource = Exclude<FailureSource, OperationSource>;
/** One validation diagnostic: a record issue (code, path) or a Language issue (code, span). */
type ValidationIssue = ValidationSource['diagnostics'][number];
/** A Model record issue addressed by its path. */
type RecordIssue = Extract<ValidationIssue, { readonly path: string }>;

/**
 * `code: message`, the evidence lines, then the recovery line. A resource failure puts its
 * declaration's `file:line:column asset @alias` before the message. A foreign failure prints the
 * owner's own code, message, evidence and recovery, exactly as the owner wrote them.
 */
export function formatFailure(error: CliFailure): readonly string[] {
  switch (error.code) {
    case 'service-rejected':
    case 'credential-unavailable':
      return failureLines(error.foreign, error.foreign.message);
    default:
      return failureLines(error, locatedMessage(error));
  }
}

/** One failure's lines; the evidence sits between the message and the recovery line. */
function failureLines(
  error: LocalFailure | OperationSource,
  message: string,
): readonly string[] {
  return [`${error.code}: ${message}`, ...sourceLines(evidenceOf(error)), error.recovery];
}

/** The evidence a failure keeps; a plain or located local failure keeps none. */
function evidenceOf(error: LocalFailure | OperationSource): FailureSource | undefined {
  if (!('source' in error)) return undefined;
  return error.source;
}

/** The message, after the resource declaration's place when the failure names one. */
function locatedMessage(error: LocalFailure): string {
  if (!('location' in error)) return error.message;
  const { file, line, column, alias } = error.location;
  return `${file}:${line}:${column} asset @${alias}: ${error.message}`;
}

/** No evidence prints nothing; validation and operation evidence print differently. */
function sourceLines(source: FailureSource | undefined): readonly string[] {
  if (source === undefined) return [];
  if ('diagnostics' in source) return source.diagnostics.flatMap(diagnosticLines);
  return operationLines(source);
}

/** A nested owner failure keeps its order and its cleanup failure. */
function operationLines(source: OperationSource): readonly string[] {
  return [
    `${source.code} ${source.path}: ${source.message}`,
    source.recovery,
    ...sourceLines(source.source),
    ...sourceLines(source.cleanup),
  ];
}

/** A record issue prints its path; a Language issue prints its span, expectation and recovery. */
function diagnosticLines(issue: ValidationIssue): readonly string[] {
  if ('path' in issue) return [`${issue.code} ${issue.path}: ${issue.message}`];
  const location = `${issue.span.start.line}:${issue.span.start.column}`;
  return [
    `${issue.code} ${location} ${issue.target}: ${issue.message}`,
    `Expected: ${issue.expected}`,
    issue.recovery,
    ...ownerLines(issue.source),
  ];
}

/** The Model issue behind a Language issue, when Language kept one. */
function ownerLines(issue: RecordIssue | undefined): readonly string[] {
  if (issue === undefined) return [];
  return [`${issue.code} ${issue.path}: ${issue.message}`];
}
