/*
 * Why this file exists
 *
 * When an agent types a command wrong, the CLI has to say what was wrong, so the agent can fix it
 * and try again. For example, `pnpm canvas read` with nothing after it prints:
 *
 *   invalid-arguments: read requires 1 operand(s)
 *
 * The word typed after a command is its operand: `my-diagram` in `read my-diagram`.
 *
 * This file writes the mistakes about which words and flags were typed. For example, a first word
 * that isn't a command, the wrong number of operands, or a flag the command doesn't accept. Every
 * check that finds one of those calls the same function here, so the same mistake is always worded
 * the same way. Every mistake here is `invalid-arguments`, except `unknownCommandFailure`, which
 * is `invalid-command`. A mistake about one typed value, such as a bad `--revision`, is written by
 * the check that finds it, in `values.ts` or `recipe-values.ts`.
 *
 * None of these functions checks anything: the checks are in the files that call them. Each one
 * returns `Result<never, LocalFailure>` (see `contract/errors.ts`): always a mistake, never a
 * value. A `LocalFailure` is a mistake the CLI found itself, not one the service sent back.
 * Nothing has been read or sent at this point, so the agent only has to fix the command and run it
 * again.
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
 * `invalid-arguments` for a flag that couldn't be read: a flag the CLI doesn't have (`--nope`), a
 * flag with nothing typed after it (`--out` at the end of the line), or a value given to `--help`.
 * The message doesn't name the flag.
 */
export function malformedFlagFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Unknown or malformed CLI flag',
    recovery: malformedFlagRecovery,
  });
}

/** `invalid-arguments` for `--section` or `--object` typed more than once. */
export function repeatedScopeFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('Each read scope flag may be provided only once.');
}

/**
 * `invalid-command` for a first word that isn't a command (`pnpm canvas bogus`), or for no word at
 * all.
 */
export function unknownCommandFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-command',
    message: 'Choose a supported canvas or profile command',
  });
}

/**
 * `invalid-arguments` for too many or too few operands. `expected` is 0 or 1. `read` typed alone
 * gets `read requires 1 operand(s)`. A two-word command is named with a dash: `recipe-admit`.
 */
export function operandCountFailure(
  name: CommandName,
  expected: OperandCount,
): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`${name} requires ${expected} operand(s)`);
}

/** `invalid-arguments` for `--profile` typed with any command but `profile lint`. */
export function misplacedProfileFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('--profile is only valid with profile lint.');
}

/** `invalid-arguments` for `profile lint` typed without `--profile`. */
export function lintWithoutProfileFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('profile lint requires --profile build-spec@1.');
}

/**
 * `invalid-arguments` for `--id` or `--title` typed with any command but `profile scaffold` or
 * `recipe admit`.
 */
export function misplacedIdOrTitleFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure(
    '--id and --title are only valid with profile scaffold or recipe admit.',
  );
}

/** `invalid-arguments` for `--section` and `--object` typed together. */
export function sectionWithObjectFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('--section and --object are mutually exclusive for read.');
}

/** `invalid-arguments` for `--section` or `--object` typed with any command but `read`. */
export function misplacedScopeFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('--section and --object are only valid with read.');
}

/**
 * `invalid-arguments` for a flag the command doesn't accept, naming both:
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
