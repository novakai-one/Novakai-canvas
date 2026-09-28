/*
 * The failures command-line reading returns before any value is checked: `invalid-arguments` for
 * an argument that is malformed, missing, misplaced or in conflict with another, and
 * `invalid-command` for a first word that names no command. Pure. Nothing was read or sent, so the
 * caller corrects the argument and runs the command again.
 */
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/** What to type instead, after a flag Node refused. */
const malformedFlagRecovery =
  'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.';

/** `invalid-arguments` with `message`, which names the argument to correct. */
export function invalidArguments(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}

/**
 * The `invalid-arguments` failure for a flag Node refused: an unknown flag, a text flag with no
 * value, or a value on a switch. The base CLI's wording is kept, so the flag is not named.
 */
export function malformedFlagFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Unknown or malformed CLI flag',
    recovery: malformedFlagRecovery,
  });
}

/** The `invalid-command` failure for a first word that names no command, or no word at all. */
export function invalidCommand(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-command',
    message: 'Choose a supported canvas or profile command',
  });
}
