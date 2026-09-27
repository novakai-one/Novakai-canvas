/*
 * The finding constructors every build-spec lint rule reports through: a finding at a
 * declaration's span or at one of its fields. Pure.
 */
import type { ProfileFinding } from '../../../contract/records/profiles.js';
import type { Declaration } from './declarations.js';

/** What a rule reports: its rule code, the declaration path it names and the message. */
export type Report = Omit<ProfileFinding, 'span'>;

/** One finding at the declaration's own span. */
export function findingAt(
  declaration: Declaration,
  report: Report,
): ProfileFinding {
  return { ...report, span: declaration.span };
}

/** One finding at a field's span, falling back to the declaration's. */
export function fieldFinding(
  declaration: Declaration,
  name: string,
  report: Report,
): ProfileFinding {
  return { ...report, span: declaration.fields[name]?.span ?? declaration.span };
}
