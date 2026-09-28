/*
 * Profile command text: the descriptor listing `profile describe` prints, with the commands that
 * run the profile, the lint summary line and the line each lint finding prints as. Pure; nothing
 * is read or written.
 */
import type { ProfileId } from '../../contract/brands.js';
import type {
  ProfileDescriptor,
  ProfileFinding,
  ProfileLintResult,
} from '../../contract/records/foreign.js';

/** A lint result that is not `passed`: the `profile-structure` failure reports it. */
type FailedLint = Exclude<ProfileLintResult, { readonly status: 'passed' }>;

/** One required slot of a descriptor. */
type Slot = ProfileDescriptor['slots'][number];

/** The descriptor as `profile describe` prints it: commands, slots, conventions, notes. */
export function displayDescriptor(descriptor: ProfileDescriptor): string {
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

/** The one-line summary: passed, the issue count, or why the source cannot be linted. */
export function lintSummary(
  profile: ProfileId,
  result: ProfileLintResult,
): string {
  switch (result.status) {
    case 'passed':
      return `${profile} structural lint passed.`;
    case 'failed':
      return `${profile} structural lint found ${result.findings.length} issue(s).`;
    case 'unsupported-source':
      return `${profile} requires a full canvas 1 document.`;
    default:
      return unsupportedStatus(profile, result);
  }
}

/**
 * The `profile-structure` message: the summary, a line break, then one line per finding. An
 * unsupported source has no findings, so its message ends with the line break.
 */
export function lintReport(
  profile: ProfileId,
  result: FailedLint,
): string {
  const findings = result.status === 'failed' ? result.findings : [];
  return `${lintSummary(profile, result)}\n${findings.map(findingLine).join('\n')}`;
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
