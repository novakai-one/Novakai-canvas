/*
 * Why this file exists
 *
 * Each command accepts only some flags. `pnpm canvas list --revision 3` makes no sense, because
 * `list` doesn't use a revision. If the CLI quietly ignored the flag, the agent would think it had
 * asked for something it didn't get. So a flag the command doesn't accept is a mistake:
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

/** A rule's verdict: `true` when the command passes it; otherwise the mistake it found. */
type RuleVerdict = Result<true, LocalFailure>;

/** One flag rule, checked against the command and its flags. */
type FlagRule = (command: CommandWithRightOperandCount) => RuleVerdict;

/** The flag rules, in the order listed on `checkCommandFlags`. */
const flagRules: readonly FlagRule[] = Object.freeze([
  checkProfileFlag,
  checkLintHasProfile,
  checkIdAndTitleFlags,
  checkSectionOrObject,
  checkScopeFlags,
  checkEveryFlagAccepted,
]);

/**
 * Checks the command got only flags it accepts, and the one flag it must have.
 *
 * It checks these six rules in order, and stops at the first mistake:
 * 1. `--profile` is only for `profile lint`.
 * 2. `profile lint` needs `--profile`.
 * 3. `--id` and `--title` are only for `profile scaffold` and `recipe admit`.
 * 4. `--section` and `--object` aren't typed together.
 * 5. `--section` and `--object` are only for `read`.
 * 6. Every other flag is one the command accepts. If not, the first flag it doesn't accept is
 *    named: `--revision is not valid with list`.
 *
 * Every mistake it finds is `invalid-arguments`, a missing `--profile` included.
 */
export function checkCommandFlags(command: CommandWithRightOperandCount): Result<AcceptedCommand> {
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

/** Rule 1: `--profile` only with `profile lint`. */
function checkProfileFlag(command: CommandWithRightOperandCount): RuleVerdict {
  if (hasMisplacedFlag(command, ['profile'])) {
    return misplacedProfileFlagFailure();
  }
  return success(true);
}

/** Rule 2: `profile lint` needs `--profile`. Checked before the scope flags. */
function checkLintHasProfile(command: CommandWithRightOperandCount): RuleVerdict {
  if (isLintWithoutProfile(command)) {
    return lintWithoutProfileFlagFailure();
  }
  return success(true);
}

/** Rule 3: `--id` and `--title` only with `profile scaffold` and `recipe admit`. */
function checkIdAndTitleFlags(command: CommandWithRightOperandCount): RuleVerdict {
  if (hasMisplacedFlag(command, ['id', 'title'])) {
    return misplacedIdOrTitleFailure();
  }
  return success(true);
}

/** Rule 4: `--section` and `--object` never together, whichever command is given them. */
function checkSectionOrObject(command: CommandWithRightOperandCount): RuleVerdict {
  if (hasSectionAndObject(command)) {
    return sectionWithObjectFailure();
  }
  return success(true);
}

/** Rule 5: `--section` and `--object` only with `read`. */
function checkScopeFlags(command: CommandWithRightOperandCount): RuleVerdict {
  if (hasMisplacedFlag(command, ['section', 'object'])) {
    return misplacedScopeFlagFailure();
  }
  return success(true);
}

/** Rule 6: every flag is one the command accepts. Names the first typed one that isn't. */
function checkEveryFlagAccepted(command: CommandWithRightOperandCount): RuleVerdict {
  const unacceptedFlag = firstUnacceptedFlag(command);
  if (unacceptedFlag !== undefined) {
    return unacceptedFlagFailure(unacceptedFlag, command.name);
  }
  return success(true);
}

/**
 * Whether any of `flags` was typed with a command that doesn't accept it. Rules 1, 3 and 5 are
 * rule 6 for their flags, checked earlier so they get their own message.
 */
function hasMisplacedFlag(
  command: CommandWithRightOperandCount,
  flags: readonly TextFlag[],
): boolean {
  return flags.some((flag) => isTypedButNotAccepted(command, flag));
}

/** Whether `flag` was typed with a command that doesn't accept it. */
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

/** The first flag, in the order typed, that the command doesn't accept. Missing if none. */
function firstUnacceptedFlag(command: CommandWithRightOperandCount): TextFlag | undefined {
  return command.flags.order.find((flag) => !acceptsFlag(command.name, flag));
}
