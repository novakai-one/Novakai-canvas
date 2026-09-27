/*
 * The finding constructors every build-spec lint rule reports through: a finding at a
 * declaration's span or at one of its fields. Pure.
 */
import type { ProfileFinding } from '../../../contract/records/profiles.js';
import type { Declaration } from './declarations.js';

/** One finding at the declaration's own span. */
export function findingAt(
  declaration: Declaration,
  path: string,
  message: string,
): ProfileFinding {
  return { path, message, span: declaration.span };
}

/** One finding at a field's span, falling back to the declaration's. */
export function fieldFinding(
  declaration: Declaration,
  name: string,
  path: string,
  message: string,
): ProfileFinding {
  return { path, message, span: declaration.fields[name]?.span ?? declaration.span };
}
