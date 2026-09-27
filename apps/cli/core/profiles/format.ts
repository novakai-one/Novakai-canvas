/*
 * Profile command text: the descriptor listing `profile describe` prints, the lint summary line
 * and the line each lint finding prints as. Pure; nothing is read or written.
 */
import type { ProfileFinding, ProfileLintResult } from '../../contract/records/profiles.js';
import { buildSpecProfile } from './build-spec/descriptor.js';

/** A lint result that is not `passed`: the `profile-structure` failure reports it. */
type FailedLint = Exclude<ProfileLintResult, { readonly status: 'passed' }>;

/** The build-spec@1 descriptor as `profile describe` prints it: commands, slots, conventions, notes. */
export function displayDescriptor(): string {
  return [
    `${buildSpecProfile.id} — ${buildSpecProfile.description}`,
    '',
    'Commands:',
    ...Object.values(buildSpecProfile.commands).map((command) => `  ${command}`),
    '',
    'Required logical documents:',
    ...buildSpecProfile.slots.map(
      (slot) => `  ${slot.order}. ${slot.id} (${slot.modes.join('|')}) — ${slot.description}`,
    ),
    `  5.N appendix (${buildSpecProfile.appendix.modes.join('|')}) — ${buildSpecProfile.appendix.description}`,
    '',
    'Structural conventions:',
    ...buildSpecProfile.conventions.map((convention) => `  ${convention}`),
    '',
    ...buildSpecProfile.notes.map((note) => `Note: ${note}`),
  ].join('\n');
}

/** The one-line summary: passed, the issue count, or why the source cannot be linted. */
export function lintSummary(result: ProfileLintResult): string {
  if (result.status === 'failed')
    return `build-spec@1 structural lint found ${result.findings.length} issue(s).`;
  return fixedSummaries[result.status];
}

/** The summary of every outcome but `failed`, whose summary counts its findings. */
const fixedSummaries: Readonly<Record<Exclude<ProfileLintResult['status'], 'failed'>, string>> =
  Object.freeze({
    passed: 'build-spec@1 structural lint passed.',
    'unsupported-source': 'build-spec@1 requires a full canvas 1 document.',
  });

/**
 * The `profile-structure` message: the summary, a line break, then one line per finding. An
 * unsupported source has no findings, so its message ends with the line break.
 */
export function lintReport(result: FailedLint): string {
  const findings = result.status === 'failed' ? result.findings : [];
  return `${lintSummary(result)}\n${findings.map(findingLine).join('\n')}`;
}

/** One finding as `PROFILE <path> <line>:<column> <message>`. */
function findingLine(finding: ProfileFinding): string {
  return `PROFILE ${finding.path} ${finding.span.start.line}:${finding.span.start.column} ${finding.message}`;
}
