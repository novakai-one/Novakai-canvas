/*
 * Why this file exists
 *
 * When a command fails, the agent reads why in the terminal, then fixes it. If Language can't
 * parse a source, the CLI prints `invalid-source: Language rejected this source`, then a line per
 * problem, such as `invalid-value 3:11 kind: Unknown enum value`, then what to do next.
 *
 * This file turns one failure into those lines. It only makes text: the failure stays a typed
 * value for code to branch on, and nothing reads these lines back.
 */
import type { CliFailure, LocalFailure } from '../../contract/errors.js';
import type { FailureSource, ServiceFailureRecord } from '../../contract/records/foreign.js';

/** A validation batch: the evidence that is not an operation failure. */
type ValidationSource = Exclude<FailureSource, ServiceFailureRecord>;
/** One validation diagnostic: a record issue (code, path) or a Language issue (code, span). */
type ValidationIssue = ValidationSource['diagnostics'][number];
/** A Model record issue addressed by its path. */
type RecordIssue = Extract<ValidationIssue, { readonly path: string }>;

/**
 * Turns a failure into the lines to print: `code: message`, the lines saying why, then what to do
 * next.
 * A font or image mistake names its place first, such as `walk.canvas:4:1 asset @logo: …`.
 * A failure the service package wrote prints exactly as written.
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
  error: LocalFailure | ServiceFailureRecord,
  message: string,
): readonly string[] {
  return [`${error.code}: ${message}`, ...sourceLines(error.source), error.recovery];
}

/** The message, after the resource declaration's place when the failure names one. */
function locatedMessage(error: LocalFailure): string {
  if (error.location === undefined) return error.message;
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
function operationLines(source: ServiceFailureRecord): readonly string[] {
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
