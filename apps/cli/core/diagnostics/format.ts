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
import type {
  CliFailure,
  ForeignFailure,
  LocalFailure,
  SourceLocation,
} from '../../contract/errors.js';
import type { FailureSource, ServiceFailureRecord } from '../../contract/records/foreign.js';

/** A batch of Language or Model issues: the evidence that is not a failure record. */
type ValidationSource = Extract<FailureSource, { readonly diagnostics: unknown }>;
/** A failure record kept as evidence: its code, path, message, and its own evidence and cleanup. */
type SourceFailureRecord = Exclude<FailureSource, ValidationSource>;
/** One issue in that batch: a Model issue (code, path) or a Language issue (code, span). */
type ValidationIssue = ValidationSource['diagnostics'][number];
/** A Model issue, addressed by its path. */
type ModelIssue = Extract<ValidationIssue, { readonly path: string }>;
/** A Language issue, addressed by its place in the text. */
type LanguageIssue = Exclude<ValidationIssue, ModelIssue>;

/**
 * Turns a failure into the lines to print: `code: message`, the lines saying why, then what to do
 * next.
 * A font or image mistake names its place first, such as `walk.canvas:4:1 asset @logo: …`.
 * A failure the service sent (a `ForeignFailure`) prints the service's own code and words.
 */
export function formatFailure(error: CliFailure): readonly string[] {
  if (isForeignFailure(error)) {
    return foreignFailureLines(error.foreign);
  }
  return localFailureLines(error);
}

/** Whether the failure is a record the service package wrote, rather than a mistake the CLI found. */
function isForeignFailure(error: CliFailure): error is ForeignFailure {
  return 'foreign' in error;
}

/** Writes a failure record the service package wrote, with the service's own code and message. */
function foreignFailureLines(foreign: ServiceFailureRecord): readonly string[] {
  return failureLines(foreign, foreign.message);
}

/** Writes a mistake the CLI found, naming the font or image declaration first when there is one. */
function localFailureLines(local: LocalFailure): readonly string[] {
  const message = locatedMessage(local);
  return failureLines(local, message);
}

/** Writes `code: message` first, then the lines saying why, then what to do next. */
function failureLines(
  failureRecord: LocalFailure | ServiceFailureRecord,
  message: string,
): readonly string[] {
  const headline = `${failureRecord.code}: ${message}`;
  const reasons = reasonLines(failureRecord.source);
  return [headline, ...reasons, failureRecord.recovery];
}

/** Puts the place of the font or image declaration before the message, when the mistake has one. */
function locatedMessage(local: LocalFailure): string {
  if (local.location === undefined) {
    return local.message;
  }
  const place = declarationPlace(local.location);
  return `${place}: ${local.message}`;
}

/** Writes where a source declares a font or image, such as `walk.canvas:4:1 asset @logo`. */
function declarationPlace(location: SourceLocation): string {
  return `${location.file}:${location.line}:${location.column} asset @${location.alias}`;
}

/**
 * Writes the lines saying why: nothing when there is no evidence, one block per Language or Model
 * issue, or the lines of a service failure record.
 */
function reasonLines(source: FailureSource | undefined): readonly string[] {
  if (source === undefined) {
    return [];
  }
  if (isValidationSource(source)) {
    return source.diagnostics.flatMap(issueLines);
  }
  return serviceFailureLines(source);
}

/** Whether the evidence is a batch of Language or Model issues, rather than a service failure. */
function isValidationSource(source: FailureSource): source is ValidationSource {
  return 'diagnostics' in source;
}

/**
 * Writes a service failure record: its code, path and message, what to do next, then its own
 * evidence and its cleanup failure, in that order.
 */
function serviceFailureLines(serviceFailure: SourceFailureRecord): readonly string[] {
  const headline = `${serviceFailure.code} ${serviceFailure.path}: ${serviceFailure.message}`;
  const reasons = reasonLines(serviceFailure.source);
  const cleanupReasons = reasonLines(serviceFailure.cleanup);
  return [headline, serviceFailure.recovery, ...reasons, ...cleanupReasons];
}

/** Writes one issue: a Model issue by its path, a Language issue by its place in the text. */
function issueLines(issue: ValidationIssue): readonly string[] {
  if (isModelIssue(issue)) {
    return [modelIssueLine(issue)];
  }
  return languageIssueLines(issue);
}

/** Whether the issue is Model's, addressed by a path rather than a place in the text. */
function isModelIssue(issue: ValidationIssue): issue is ModelIssue {
  return 'path' in issue;
}

/** Writes a Model issue as one line: its code, path and message. */
function modelIssueLine(issue: ModelIssue): string {
  return `${issue.code} ${issue.path}: ${issue.message}`;
}

/**
 * Writes a Language issue: its code, line and column, target and message, then what was
 * expected, what to do next, and the original Model issue behind it when Language kept one.
 */
function languageIssueLines(issue: LanguageIssue): readonly string[] {
  const start = issue.span.start;
  const headline = `${issue.code} ${start.line}:${start.column} ${issue.target}: ${issue.message}`;
  const modelReasons = originalModelIssueLines(issue.source);
  return [headline, `Expected: ${issue.expected}`, issue.recovery, ...modelReasons];
}

/** Writes the original Model issue behind a Language issue, or nothing when Language kept none. */
function originalModelIssueLines(original: ModelIssue | undefined): readonly string[] {
  if (original === undefined) {
    return [];
  }
  return [modelIssueLine(original)];
}
