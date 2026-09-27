/*
 * Profile command text: the descriptor listing `profile describe` prints and the line each lint
 * finding prints as. Pure; nothing is read or written.
 */
import type { ProfileFinding } from '../../contract/records/profiles.js';
import { buildSpecProfile } from './build-spec/descriptor.js';

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

/** One finding as `PROFILE <path> <line>:<column> <message>`. */
export function findingLine(finding: ProfileFinding): string {
  return `PROFILE ${finding.path} ${finding.span.start.line}:${finding.span.start.column} ${finding.message}`;
}
