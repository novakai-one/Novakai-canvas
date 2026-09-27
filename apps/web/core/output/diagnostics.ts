/*
 * Display text for a failure: the one-line summary the problem bar shows and the technical detail
 * lines. Display only; the failure stays structured for recovery and for code that branches on
 * `origin` and `code`. Pure.
 */
import type { Diagnostic, ForeignDiagnostic } from '../../contract/errors.js';

/** The code, message and recovery, with every owner detail behind the failure in between. */
export function formatFailure(error: Diagnostic): readonly string[] {
  return [`${error.code}: ${error.message}`, ...evidenceLines(evidence(error)), error.recovery];
}

/** The actionable owner cause; the full chain stays available as technical details. */
export function failureSummary(error: Diagnostic): string {
  return plainMessage(evidenceSummary(evidence(error)) ?? error.message);
}

/** Plain-English text for machine failure codes that owners serialize into a message. */
const codeMessages: Readonly<Record<string, string>> = Object.freeze({
  'unroutable-leg': "Couldn't route a wire for that position. Nothing was changed.",
  'infeasible-embedding': "Couldn't fit the wires around that position. Nothing was changed.",
});
const unknownCodeMessage = "That change couldn't be applied. Nothing was changed.";

/** Raw JSON never reaches a person; readable messages pass through unchanged. */
export function plainMessage(message: string): string {
  const code = /\{\s*"code"\s*:\s*"([^"]+)"/.exec(message)?.[1];
  if (code !== undefined) return codeMessages[code] ?? unknownCodeMessage;
  return message.trim().startsWith('{') ? unknownCodeMessage : message;
}

/** A failure an owner answered over the service wire. */
type OperationSource = Extract<ForeignDiagnostic, { readonly origin: 'service' }>['source'];

/** What an owner kept under its failure: a list of problems, or an operation's own failure. */
type Evidence = NonNullable<OperationSource['source']>;

/** One problem in a list: a record address, or a span in source text. */
type Problem = Extract<Evidence, { readonly diagnostics: unknown }>['diagnostics'][number];

/** The owner record Language keeps under a `domain` problem. */
type RecordIssue = NonNullable<Extract<Problem, { readonly span: unknown }>['source']>;

/** The evidence behind a failure: a web failure's cause, or a foreign failure's own. */
function evidence(error: Diagnostic): Evidence | undefined {
  if (error.origin !== 'web') return foreignEvidence(error);
  return error.cause === undefined ? undefined : foreignEvidence(error.cause);
}

/** What each owner kept under its failure; Canvas and Design System keep nothing further. */
function foreignEvidence(error: ForeignDiagnostic): Evidence | undefined {
  switch (error.origin) {
    case 'authoring':
    case 'service':
    case 'unrecognised':
    case 'layout':
    case 'presentation':
      return error.source.source;
    case 'library':
    case 'language':
      return error.source;
    case 'canvas':
    case 'design-system':
      return undefined;
    default:
      return unsupported(error);
  }
}

/** The first problem's message, found through nested operation failures. */
function evidenceSummary(source: Evidence | undefined): string | undefined {
  if (source === undefined) return undefined;
  if ('diagnostics' in source) return source.diagnostics[0].message;
  return evidenceSummary(source.source) ?? source.message;
}

/** Absence means nothing further; problem lists and operation failures stay distinct. */
function evidenceLines(source: Evidence | undefined): readonly string[] {
  if (source === undefined) return [];
  if ('diagnostics' in source) return source.diagnostics.flatMap(problemLines);
  return operationLines(source);
}

/** Nested owner failures preserve order and cleanup guidance in the final display. */
function operationLines(source: OperationSource): readonly string[] {
  return [
    `${source.code} ${source.path}: ${source.message}`,
    source.recovery,
    ...evidenceLines(source.source),
    ...evidenceLines(source.cleanup),
  ];
}

/** Source spans and record paths are explicit addresses; no parser reads the resulting text. */
function problemLines(issue: Problem): readonly string[] {
  if ('path' in issue) return [`${issue.code} ${issue.path}: ${issue.message}`];
  const location = `${issue.span.start.line}:${issue.span.start.column}`;
  return [
    `${issue.code} ${location} ${issue.target}: ${issue.message}`,
    `Expected: ${issue.expected}`,
    issue.recovery,
    ...recordLines(issue.source),
  ];
}

/** Language enrichment can point back to a precise Model code/path without sacrificing the source span. */
function recordLines(issue: RecordIssue | undefined): readonly string[] {
  if (issue === undefined) return [];
  return [`${issue.code} ${issue.path}: ${issue.message}`];
}

/** No owner of another kind exists; the `never` type proves every owner above is handled. */
function unsupported(error: never): undefined {
  void error;
  return undefined;
}
