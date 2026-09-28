/*
 * Why this file exists
 *
 * When an agent types a command wrong, the CLI has to say what was wrong, so the agent can fix it
 * and try again. For example, `pnpm canvas read` with nothing after it prints:
 *
 *   invalid-arguments: read requires 1 operand(s)
 *
 * This file writes the mistakes about the command's shape: which words and flags were typed. For
 * example, a first word that isn't a command, the wrong number of words, or a flag the command
 * doesn't take. Every check that finds one of those uses the same function here, so the same
 * mistake is always worded the same way. A mistake about one typed value, such as a bad
 * `--revision`, is written by the check that finds it, in `values.ts` or `recipe-values.ts`.
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
import type { OperandCount } from './table.js';

/** What to type instead, after a flag that couldn't be read. */
const malformedFlagRecovery =
  'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.';

/**
 * Returns the `invalid-arguments` mistake, with `message` saying which word or flag to fix. For
 * example: `--revision is not valid with list`.
 */
export function invalidArgumentsFailure(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}

/**
 * Returns the mistake for a flag that couldn't be read: a flag the CLI doesn't have (`--nope`), a
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

/** Returns the mistake for `--section` or `--object` typed more than once. */
export function repeatedScopeFlagFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('Each read scope flag may be provided only once.');
}

/**
 * Returns the mistake for a first word that isn't a command (`pnpm canvas bogus`), or for no word
 * at all.
 */
export function unknownCommandFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-command',
    message: 'Choose a supported canvas or profile command',
  });
}

/**
 * Returns the mistake for too many or too few words after the command. `read` typed alone gets
 * `read requires 1 operand(s)`. A two-word command is named with a dash: `recipe-admit`.
 */
export function operandCountFailure(
  name: CommandName,
  expected: OperandCount,
): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`${name} requires ${expected} operand(s)`);
}

/** Returns the mistake for `profile lint` typed without `--profile`. */
export function missingLintProfileFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure('profile lint requires --profile build-spec@1.');
}
