/*
 * Why this file exists
 *
 * When an agent types a command wrong, the CLI must say what was wrong, the same way each time.
 * `pnpm canvas read` alone gets `invalid-arguments: read requires 1 operand(s)`.
 *
 * This file makes the mistakes about which words and flags were typed. Each function returns
 * `Result<never, LocalFailure>`: always a mistake, one the CLI found itself. It never checks
 * anything: the checks call it.
 */
import type { CommandName } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { TextFlag } from './flags.js';
import { commandAsTyped } from './table.js';
import type { OperandCount } from './table.js';

/** What to type instead, after a flag that couldn't be read. */
const malformedFlagRecovery =
  'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.';

/**
 * Makes the mistake for a flag that couldn't be read (`invalid-arguments`).
 *
 * Such as `--nope`, `--out` with nothing after it, or a value given to `--help`. The message
 * doesn't name the flag.
 */
export function malformedFlagFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Unknown or malformed CLI flag',
    recovery: malformedFlagRecovery,
  });
}

/** Makes the mistake for `--section` or `--object` typed more than once (`invalid-arguments`). */
export function repeatedScopeFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('Each read scope flag may be provided only once.');
}

/**
 * Makes the mistake for a first word that isn't a command, or no word at all (`invalid-command`).
 */
export function unknownCommandFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-command',
    message: 'Choose a supported canvas or profile command',
  });
}

/**
 * Makes the mistake for too many or too few words after the command (`invalid-arguments`).
 *
 * `read` alone gets `read requires 1 operand(s)`. `expected` is 0 or 1.
 */
export function operandCountFailure(
  name: CommandName,
  expected: OperandCount,
): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`${name} requires ${expected} operand(s)`);
}

/** Makes the mistake for `--profile` typed with any command but `profile lint`. */
export function misplacedProfileFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('--profile is only valid with profile lint.');
}

/** Makes the mistake for `profile lint` typed without `--profile`. */
export function lintWithoutProfileFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('profile lint requires --profile build-spec@1.');
}

/**
 * Makes the mistake for `--id` or `--title` typed with any command but `profile scaffold` or
 * `recipe admit`.
 */
export function misplacedIdOrTitleFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure(
    '--id and --title are only valid with profile scaffold or recipe admit.',
  );
}

/** Makes the mistake for `--section` and `--object` typed together. */
export function sectionWithObjectFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('--section and --object are mutually exclusive for read.');
}

/** Makes the mistake for `--section` or `--object` typed with any command but `read`. */
export function misplacedScopeFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('--section and --object are only valid with read.');
}

/**
 * Makes the mistake for a flag the command doesn't accept, naming both:
 * `--revision is not valid with list`.
 */
export function unacceptedFlagFailure(
  flag: TextFlag,
  name: CommandName,
): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`--${flag} is not valid with ${commandAsTyped(name)}`);
}

/** The `invalid-arguments` mistake with `message`. */
function invalidArgumentsFailure(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}
