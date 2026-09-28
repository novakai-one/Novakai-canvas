/*
 * Why this file exists
 *
 * The profile commands print plain text for an agent to read. `profile describe build-spec@1`
 * prints the profile's rules and the commands that use it. `profile lint` prints one line, such as
 * `build-spec@1 structural lint found 2 issue(s).`, then one line per broken rule.
 *
 * This file writes that text from what Language gives back. It only builds strings; it never
 * reads or prints anything.
 */
import type { ProfileId } from '../../contract/brands.js';
import type {
  ProfileDescriptor,
  ProfileFinding,
  ProfileLintResult,
} from '../../contract/records/foreign.js';

/** A lint that did not pass: rules were broken (`failed`), or the source was only a patch. */
type FailedLint = Exclude<ProfileLintResult, { readonly status: 'passed' }>;

/** One required slot of a descriptor. */
type Slot = ProfileDescriptor['slots'][number];

/**
 * Writes what `profile describe` prints: the profile's name and purpose, the commands that use it,
 * the parts a source must have, its rules and its notes.
 */
export function formatDescriptor(descriptor: ProfileDescriptor): string {
  const titleLine = `${descriptor.id} — ${descriptor.description}`;
  const commandLines = profileCommands(descriptor.id).map(indentedLine);
  const slotLines = descriptor.slots.map(slotLine);
  const appendixRule = appendixLine(descriptor.appendix);
  const conventionLines = descriptor.conventions.map(indentedLine);
  const noteLines = descriptor.notes.map(noteLine);
  // Each '' is a blank line between two parts.
  const lines = [
    titleLine,
    '',
    'Commands:',
    ...commandLines,
    '',
    'Required logical documents:',
    ...slotLines,
    appendixRule,
    '',
    'Structural conventions:',
    ...conventionLines,
    '',
    ...noteLines,
  ];
  return lines.join('\n');
}

/**
 * Writes the one-line lint summary, such as `build-spec@1 structural lint passed.` A failed lint
 * gives its number of issues; a patch gets `build-spec@1 requires a full canvas 1 document.`
 */
export function formatLintSummary(
  profile: ProfileId,
  outcome: ProfileLintResult,
): string {
  switch (outcome.status) {
    case 'passed':
      return `${profile} structural lint passed.`;
    case 'failed':
      return `${profile} structural lint found ${outcome.findings.length} issue(s).`;
    case 'unsupported-source':
      return `${profile} requires a full canvas 1 document.`;
    default:
      return unsupportedStatusSummary(profile, outcome);
  }
}

/**
 * Writes the message of a lint that did not pass: the summary line, then one line per broken rule,
 * such as `PROFILE section @repo 12:3 <message>`. A patch has no broken rules, so its message is
 * the summary line and a line break.
 */
export function formatLintReport(
  profile: ProfileId,
  outcome: FailedLint,
): string {
  const summaryLine = formatLintSummary(profile, outcome);
  const findingsText = findingLines(outcome).join('\n');
  return `${summaryLine}\n${findingsText}`;
}

/** Writes the describe, scaffold and lint command lines for one profile. */
function profileCommands(profile: ProfileId): readonly string[] {
  return [
    `canvas profile describe ${profile}`,
    `canvas profile scaffold ${profile} --id example --title "Example build" --out /tmp/example.canvas`,
    `canvas profile lint FILE --profile ${profile}`,
  ];
}

/** Writes a line indented by two spaces, as the command and convention lists show them. */
function indentedLine(line: string): string {
  return `  ${line}`;
}

/** Writes one required slot as `<number>. @<section> (<mode>) — <description>`. */
function slotLine(slot: Slot): string {
  return `  ${slot.number}. @${slot.id} (${slot.mode}) — ${slot.description}`;
}

/** Writes the appendix rule as `<number>.N appendix (<modes>) — <description>`. */
function appendixLine(appendix: ProfileDescriptor['appendix']): string {
  const modes = appendix.modes.join('|');
  return `  ${appendix.number}.N appendix (${modes}) — ${appendix.description}`;
}

/** Writes one note as `Note: <note>`. */
function noteLine(note: string): string {
  return `Note: ${note}`;
}

/**
 * Writes the summary for a lint status Language never sends. Its `never` parameter makes the
 * compiler prove `formatLintSummary` handles every status.
 */
function unsupportedStatusSummary(
  profile: ProfileId,
  outcome: never,
): string {
  void outcome;
  return `${profile} structural lint returned an unsupported status.`;
}

/** Writes one line per broken rule. A patch broke no rules, so it gets none. */
function findingLines(outcome: FailedLint): readonly string[] {
  if (outcome.status === 'unsupported-source') {
    return [];
  }
  return outcome.findings.map(findingLine);
}

/** Writes one broken rule as `PROFILE <path> <line>:<column> <message>`. */
function findingLine(finding: ProfileFinding): string {
  const start = finding.span.start;
  const position = `${start.line}:${start.column}`;
  return `PROFILE ${finding.path} ${position} ${finding.message}`;
}
