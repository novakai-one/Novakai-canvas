/*
 * The failures for a command line whose words or flags are wrong: `invalid-arguments` for an
 * argument that is malformed, missing, misplaced or in conflict with another, and
 * `invalid-command` for a first word that names no command. The base CLI's wording is kept. Pure.
 * Nothing was read or sent, so the caller corrects the argument and runs the command again.
 */
import type { CommandName } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/** How many words a command takes after its name. */
export type OperandCount = 0 | 1;

/** What to type instead, after a flag Node refused. */
const malformedFlagRecovery =
  'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.';

/** `invalid-arguments` with `message`, which names the argument to correct. */
export function invalidArgumentsFailure(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}

/**
 * The `invalid-arguments` failure for a flag Node refused: an unknown flag, a text flag with no
 * value, or a value on a switch. The base CLI's wording does not name the flag.
 */
export function malformedFlagFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Unknown or malformed CLI flag',
    recovery: malformedFlagRecovery,
  });
}

/** The `invalid-arguments` failure for `--section` or `--object` typed more than once. */
export function repeatedScopeFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('Each read scope flag may be provided only once.');
}

/** The `invalid-command` failure for a first word that names no command, or no word at all. */
export function unknownCommandFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-command',
    message: 'Choose a supported canvas or profile command',
  });
}

/**
 * The `invalid-arguments` failure for more or fewer words than the command takes. The base CLI's
 * wording names the joined command, such as `recipe-admit requires 1 operand(s)`.
 */
export function operandCountFailure(
  name: CommandName,
  expected: OperandCount,
): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`${name} requires ${expected} operand(s)`);
}

/** The `invalid-arguments` failure for `profile lint` without --profile. */
export function lintProfileRequiredFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('profile lint requires --profile build-spec@1.');
}
