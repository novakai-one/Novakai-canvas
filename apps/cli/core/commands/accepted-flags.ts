/*
 * Why this file exists
 *
 * Each command takes only some flags. `pnpm canvas list --revision 3` makes no sense, because
 * `list` doesn't use a revision. If the CLI quietly ignored the flag, the agent would think it had
 * asked for something it didn't get. So a flag the command doesn't take is a mistake:
 *
 *   invalid-arguments: --revision is not valid with list
 *
 * One command also has a flag it must have: `profile lint` needs `--profile`. This file is the one
 * place that reports it missing.
 *
 * This file checks every typed flag against the command's row in `table.ts`. A few flags get their
 * own message. For example, `--profile` only goes with `profile lint`, and `--section` and
 * `--object` can't be typed together. The checks run in a fixed order, and only the first mistake
 * is reported.
 *
 * It only checks which flags were typed, never the text typed after them: `assembly.ts` checks
 * that next. Each check answers with a `Result` (see `contract/errors.ts`), and the mistakes are
 * made in `failures.ts`.
 */
import type { LocalFailure, Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import type { AcceptedCommand, CommandWithRightOperandCount } from './command-stages.js';
import { invalidArgumentsFailure, missingLintProfileFailure } from './failures.js';
import type { TextFlag } from './flags.js';
import { commandAsTyped, takesFlag } from './table.js';

/** A rule's verdict: `true` when the command passes it; otherwise the failure naming the flag. */
type RuleVerdict = Result<true, LocalFailure>;

/** One flag rule, checked against the command and its flags. */
type FlagRule = (command: CommandWithRightOperandCount) => RuleVerdict;

/** The flag rules, in the order listed on `checkAcceptedFlags`. */
const flagRules: readonly FlagRule[] = Object.freeze([
  rejectMisplacedProfile,
  requireLintProfile,
  rejectMisplacedIdOrTitle,
  rejectSectionWithObject,
  rejectMisplacedScopeFlags,
  rejectUnacceptedFlag,
]);

/**
 * Checks the command got only the flags it takes, and the one it must have.
 *
 * It checks these six things in order, and stops at the first mistake:
 * 1. `--profile` is only for `profile lint`.
 * 2. `profile lint` needs `--profile`.
 * 3. `--id` and `--title` are only for `profile scaffold` and `recipe admit`.
 * 4. `--section` and `--object` aren't typed together.
 * 5. `--section` and `--object` are only for `read`.
 * 6. Every other flag is one the command takes. If not, the first flag it doesn't take is named:
 *    `--revision is not valid with list`.
 *
 * Every mistake it finds is `invalid-arguments`, a missing `--profile` included.
 */
export function checkAcceptedFlags(command: CommandWithRightOperandCount): Result<AcceptedCommand> {
  // `checkNextRule` passes the first failure along unchanged, so later rules are skipped.
  const checked = flagRules.reduce(checkNextRule, success(command));
  if (!checked.ok) {
    return checked;
  }
  const accepted = keepFlagText(checked.value);
  return success(accepted);
}

/** Checks the command against the next rule, or passes an earlier failure on unchanged. */
function checkNextRule(
  checked: Result<CommandWithRightOperandCount>,
  rule: FlagRule,
): Result<CommandWithRightOperandCount> {
  if (!checked.ok) {
    return checked;
  }
  const verdict = rule(checked.value);
  if (!verdict.ok) {
    return verdict;
  }
  return checked;
}

/** The checked command with its flags' text only: their order was needed only by rule 6. */
function keepFlagText(checked: CommandWithRightOperandCount): AcceptedCommand {
  const flags = checked.flags.text;
  return { ...checked, flags };
}

/** Rule 1: --profile only with `profile lint`. */
function rejectMisplacedProfile(command: CommandWithRightOperandCount): RuleVerdict {
  return rejectMisplacedFlags(command, ['profile'], '--profile is only valid with profile lint.');
}

/** Rule 2: `profile lint` needs --profile. Checked before the scope flags. */
function requireLintProfile(command: CommandWithRightOperandCount): RuleVerdict {
  const lintWithoutProfile =
    command.name === 'profile-lint' && command.flags.text.profile === undefined;
  if (lintWithoutProfile) {
    return missingLintProfileFailure();
  }
  return success(true);
}

/** Rule 3: --id and --title only with `profile scaffold` and `recipe admit`. */
function rejectMisplacedIdOrTitle(command: CommandWithRightOperandCount): RuleVerdict {
  return rejectMisplacedFlags(
    command,
    ['id', 'title'],
    '--id and --title are only valid with profile scaffold or recipe admit.',
  );
}

/** Rule 4: --section and --object never together, whichever command is given them. */
function rejectSectionWithObject(command: CommandWithRightOperandCount): RuleVerdict {
  const { section, object } = command.flags.text;
  const bothGiven = section !== undefined && object !== undefined;
  if (bothGiven) {
    return invalidArgumentsFailure('--section and --object are mutually exclusive for read.');
  }
  return success(true);
}

/** Rule 5: --section and --object only with `read`. */
function rejectMisplacedScopeFlags(command: CommandWithRightOperandCount): RuleVerdict {
  return rejectMisplacedFlags(
    command,
    ['section', 'object'],
    '--section and --object are only valid with read.',
  );
}

/** Rule 6: the first flag the command does not accept fails, in the order the flags were given. */
function rejectUnacceptedFlag(command: CommandWithRightOperandCount): RuleVerdict {
  const refusedFlag = command.flags.typedOrder.find((flag) => !takesFlag(command.name, flag));
  if (refusedFlag !== undefined) {
    return invalidArgumentsFailure(
      `--${refusedFlag} is not valid with ${commandAsTyped(command.name)}`,
    );
  }
  return success(true);
}

/**
 * Fails with `message` when any of `restrictedFlags` is given to a command that does not accept
 * it. Rules 1, 3 and 5 are rule 6 for their flags, checked earlier with their own message.
 */
function rejectMisplacedFlags(
  command: CommandWithRightOperandCount,
  restrictedFlags: readonly TextFlag[],
  message: string,
): RuleVerdict {
  const misplaced = restrictedFlags.some((flag) => isGivenButRefused(command, flag));
  if (misplaced) {
    return invalidArgumentsFailure(message);
  }
  return success(true);
}

/** Whether `flag` was given to a command that does not accept it. */
function isGivenButRefused(
  command: CommandWithRightOperandCount,
  flag: TextFlag,
): boolean {
  const isGiven = command.flags.text[flag] !== undefined;
  return isGiven && !takesFlag(command.name, flag);
}
