/*
 * Why this file exists
 *
 * Each command accepts only some flags. If the CLI quietly ignored an extra flag, the agent would
 * think it got something it didn't. For example, `pnpm canvas list --revision 3` is refused:
 * `list` has no revision.
 *
 * This file checks every typed flag against the flags its command accepts (its row in `table.ts`).
 * It never checks the text typed after a flag.
 */
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import type { AcceptedCommand, CommandWithRightOperandCount } from './command-stages.js';
import {
  lintWithoutProfileFlagFailure,
  misplacedIdOrTitleFailure,
  misplacedProfileFlagFailure,
  misplacedScopeFlagFailure,
  sectionWithObjectFailure,
  unacceptedFlagFailure,
} from './failures.js';
import type { TextFlag } from './flags.js';
import { acceptsFlag } from './table.js';

/**
 * One flag rule. It passes the command on unchanged when the command keeps the rule, or returns
 * the mistake it found.
 */
type FlagRule = (command: CommandWithRightOperandCount) => Result<CommandWithRightOperandCount>;

/** The flag rules, checked in this order. Only the first mistake is reported. */
const flagRules: readonly FlagRule[] = Object.freeze([
  checkProfileFlag,
  checkLintHasProfile,
  checkIdAndTitleFlags,
  checkSectionOrObject,
  checkScopeFlags,
  checkEveryFlagAccepted,
]);

/**
 * Checks that every typed flag is one the command accepts, and that `profile lint` has `--profile`.
 *
 * `list --revision 3` gets `invalid-arguments: --revision is not valid with list`.
 * The mistakes it can find: a flag the command doesn't accept, `--section` with `--object`, or
 * `profile lint` without `--profile`.
 */
export function checkAcceptedFlags(command: CommandWithRightOperandCount): Result<AcceptedCommand> {
  // `checkNextRule` passes the first mistake along unchanged, so later rules are skipped.
  const checked = flagRules.reduce(checkNextRule, success(command));
  if (!checked.ok) {
    return checked;
  }
  const accepted = keepFlagText(checked.value);
  return success(accepted);
}

/** Checks the command against the next rule, or passes an earlier mistake on unchanged. */
function checkNextRule(
  checkedSoFar: Result<CommandWithRightOperandCount>,
  rule: FlagRule,
): Result<CommandWithRightOperandCount> {
  if (!checkedSoFar.ok) {
    return checkedSoFar;
  }
  return rule(checkedSoFar.value);
}

/** Keeps only the text of each flag, since their order was needed only by rule 6. */
function keepFlagText(checked: CommandWithRightOperandCount): AcceptedCommand {
  const flags = checked.flags.text;
  return { ...checked, flags };
}

/** Rule 1: refuses `--profile` with any command but `profile lint`. */
function checkProfileFlag(
  command: CommandWithRightOperandCount,
): Result<CommandWithRightOperandCount> {
  if (hasMisplacedFlag(command, ['profile'])) {
    return misplacedProfileFlagFailure();
  }
  return success(command);
}

/** Rule 2: refuses `profile lint` typed without `--profile`. */
function checkLintHasProfile(
  command: CommandWithRightOperandCount,
): Result<CommandWithRightOperandCount> {
  if (isLintWithoutProfile(command)) {
    return lintWithoutProfileFlagFailure();
  }
  return success(command);
}

/** Rule 3: refuses `--id` or `--title` except with `profile scaffold` or `recipe admit`. */
function checkIdAndTitleFlags(
  command: CommandWithRightOperandCount,
): Result<CommandWithRightOperandCount> {
  if (hasMisplacedFlag(command, ['id', 'title'])) {
    return misplacedIdOrTitleFailure();
  }
  return success(command);
}

/** Rule 4: refuses `--section` and `--object` typed together, whatever the command. */
function checkSectionOrObject(
  command: CommandWithRightOperandCount,
): Result<CommandWithRightOperandCount> {
  if (hasSectionAndObject(command)) {
    return sectionWithObjectFailure();
  }
  return success(command);
}

/** Rule 5: refuses `--section` or `--object` with any command but `read`. */
function checkScopeFlags(
  command: CommandWithRightOperandCount,
): Result<CommandWithRightOperandCount> {
  if (hasMisplacedFlag(command, ['section', 'object'])) {
    return misplacedScopeFlagFailure();
  }
  return success(command);
}

/** Rule 6: refuses any flag the command doesn't accept, naming the first one typed. */
function checkEveryFlagAccepted(
  command: CommandWithRightOperandCount,
): Result<CommandWithRightOperandCount> {
  const unacceptedFlag = firstUnacceptedFlag(command);
  if (unacceptedFlag !== undefined) {
    return unacceptedFlagFailure(unacceptedFlag, command.name);
  }
  return success(command);
}

/**
 * Whether any of these flags was typed with a command that doesn't accept it. (Rules 1, 3 and 5
 * are rule 6 for their own flags, checked first so each gets its own message.)
 */
function hasMisplacedFlag(
  command: CommandWithRightOperandCount,
  flags: readonly TextFlag[],
): boolean {
  return flags.some((flag) => isTypedButNotAccepted(command, flag));
}

/** Whether the flag was typed with a command that doesn't accept it. */
function isTypedButNotAccepted(
  command: CommandWithRightOperandCount,
  flag: TextFlag,
): boolean {
  const isTyped = command.flags.text[flag] !== undefined;
  return isTyped && !acceptsFlag(command.name, flag);
}

/** Whether the command is `profile lint`, typed without `--profile`. */
function isLintWithoutProfile(command: CommandWithRightOperandCount): boolean {
  return command.name === 'profile-lint' && command.flags.text.profile === undefined;
}

/** Whether both `--section` and `--object` were typed. */
function hasSectionAndObject(command: CommandWithRightOperandCount): boolean {
  const { section, object } = command.flags.text;
  return section !== undefined && object !== undefined;
}

/** Finds the first flag, in the order typed, that the command doesn't accept. */
function firstUnacceptedFlag(command: CommandWithRightOperandCount): TextFlag | undefined {
  return command.flags.order.find((flag) => !acceptsFlag(command.name, flag));
}
