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
  return [
    `${descriptor.id} — ${descriptor.description}`,
    '',
    'Commands:',
    ...profileCommands(descriptor.id).map((command) => `  ${command}`),
    '',
    'Required logical documents:',
    ...descriptor.slots.map(slotLine),
    appendixLine(descriptor.appendix),
    '',
    'Structural conventions:',
    ...descriptor.conventions.map((convention) => `  ${convention}`),
    '',
    ...descriptor.notes.map((note) => `Note: ${note}`),
  ].join('\n');
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
      return unsupportedStatus(profile, outcome);
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
  const findings = outcome.status === 'failed' ? outcome.findings : [];
  return `${formatLintSummary(profile, outcome)}\n${findings.map(findingLine).join('\n')}`;
}

/**
 * The summary for a lint status of no known kind. Language's closed `ProfileLintResult` makes this
 * unreachable; the `never` type proves every status above is handled.
 */
function unsupportedStatus(
  profile: ProfileId,
  result: never,
): string {
  void result;
  return `${profile} structural lint returned an unsupported status.`;
}

/** The describe, scaffold and lint command lines for one profile, as `profile describe` lists them. */
function profileCommands(profile: ProfileId): readonly string[] {
  return [
    `canvas profile describe ${profile}`,
    `canvas profile scaffold ${profile} --id example --title "Example build" --out /tmp/example.canvas`,
    `canvas profile lint FILE --profile ${profile}`,
  ];
}

/** One required slot as `<number>. @<section> (<mode>) — <description>`. */
function slotLine(slot: Slot): string {
  return `  ${slot.number}. @${slot.id} (${slot.mode}) — ${slot.description}`;
}

/** The appendix rule as `<number>.N appendix (<modes>) — <description>`. */
function appendixLine(appendix: ProfileDescriptor['appendix']): string {
  return `  ${appendix.number}.N appendix (${appendix.modes.join('|')}) — ${appendix.description}`;
}

/** One finding as `PROFILE <path> <line>:<column> <message>`. */
function findingLine(finding: ProfileFinding): string {
  return `PROFILE ${finding.path} ${finding.span.start.line}:${finding.span.start.column} ${finding.message}`;
}
