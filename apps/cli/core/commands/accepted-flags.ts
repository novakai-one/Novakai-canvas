/*
 * Which flags a command may be given: only the flags its table row accepts, never --section
 * together with --object, and always --profile for `profile lint`. The base CLI's wording and
 * order are kept. Pure. `parse.ts` checks this after the operand count; a failure names the flag,
 * and nothing was read or sent, so the caller corrects the flag and runs the command again.
 */
import type { LocalFailure, Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import type { AcceptedCommand, CountedCommand } from './command-stages.js';
import { invalidArgumentsFailure, lintProfileRequiredFailure } from './failures.js';
import type { TextFlag } from './flags.js';
import { refusesFlag, typedName } from './table.js';

/** A rule's verdict: `true` when the command passes it; otherwise the failure naming the flag. */
type RuleVerdict = Result<true, LocalFailure>;

/** One flag rule, checked against the command and its flags. */
type FlagRule = (counted: CountedCommand) => RuleVerdict;

/** The flag rules, in the base CLI's order (listed on `checkAcceptedFlags`). */
const flagRules: readonly FlagRule[] = Object.freeze([
  rejectMisplacedProfile,
  requireLintProfile,
  rejectMisplacedIdOrTitle,
  rejectSectionWithObject,
  rejectMisplacedScopeFlags,
  rejectUnacceptedFlag,
]);

/**
 * The command, once every flag rule passes.
 *
 * Fails with `invalid-arguments` for the first broken rule, in this order:
 * 1. `rejectMisplacedProfile`: --profile given to any command but `profile lint`.
 * 2. `requireLintProfile`: `profile lint` given without --profile.
 * 3. `rejectMisplacedIdOrTitle`: --id or --title given to any command but `profile scaffold` and
 *    `recipe admit`.
 * 4. `rejectSectionWithObject`: --section and --object given together.
 * 5. `rejectMisplacedScopeFlags`: --section or --object given to any command but `read`.
 * 6. `rejectUnacceptedFlag`: any other flag the command does not accept, named as
 *    `--X is not valid with COMMAND`.
 *
 * Flag values are not checked here; `assembly.ts` checks them.
 */
export function checkAcceptedFlags(counted: CountedCommand): Result<AcceptedCommand> {
  // `checkNextRule` passes the first failure along unchanged, so later rules are skipped.
  const checked = flagRules.reduce(checkNextRule, success(counted));
  if (!checked.ok) {
    return checked;
  }
  const accepted = keepFlagText(checked.value);
  return success(accepted);
}

/** Checks the command against the next rule, or passes an earlier failure on unchanged. */
function checkNextRule(
  checked: Result<CountedCommand>,
  rule: FlagRule,
): Result<CountedCommand> {
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
function keepFlagText(checked: CountedCommand): AcceptedCommand {
  const flags = checked.flags.text;
  return { ...checked, flags };
}

/** Rule 1: --profile only with `profile lint`. */
function rejectMisplacedProfile(counted: CountedCommand): RuleVerdict {
  return rejectMisplacedFlags(counted, ['profile'], '--profile is only valid with profile lint.');
}

/** Rule 2: `profile lint` needs --profile. Checked before the scope flags, as the base CLI does. */
function requireLintProfile(counted: CountedCommand): RuleVerdict {
  const lintWithoutProfile =
    counted.name === 'profile-lint' && counted.flags.text.profile === undefined;
  if (lintWithoutProfile) {
    return lintProfileRequiredFailure();
  }
  return success(true);
}

/** Rule 3: --id and --title only with `profile scaffold` and `recipe admit`. */
function rejectMisplacedIdOrTitle(counted: CountedCommand): RuleVerdict {
  return rejectMisplacedFlags(
    counted,
    ['id', 'title'],
    '--id and --title are only valid with profile scaffold or recipe admit.',
  );
}

/** Rule 4: --section and --object never together, whichever command is given them. */
function rejectSectionWithObject(counted: CountedCommand): RuleVerdict {
  const { section, object } = counted.flags.text;
  const bothGiven = section !== undefined && object !== undefined;
  if (bothGiven) {
    return invalidArgumentsFailure('--section and --object are mutually exclusive for read.');
  }
  return success(true);
}

/** Rule 5: --section and --object only with `read`. */
function rejectMisplacedScopeFlags(counted: CountedCommand): RuleVerdict {
  return rejectMisplacedFlags(
    counted,
    ['section', 'object'],
    '--section and --object are only valid with read.',
  );
}

/** Rule 6: the first flag the command does not accept fails, in the order the flags were given. */
function rejectUnacceptedFlag(counted: CountedCommand): RuleVerdict {
  const refusedFlag = counted.flags.givenOrder.find((flag) => refusesFlag(counted.name, flag));
  if (refusedFlag !== undefined) {
    return invalidArgumentsFailure(`--${refusedFlag} is not valid with ${typedName(counted.name)}`);
  }
  return success(true);
}

/**
 * Fails with `message` when any of `restrictedFlags` is given to a command that does not accept
 * it. Rules 1, 3 and 5 are rule 6 for their flags, checked earlier with the base CLI's wording.
 */
function rejectMisplacedFlags(
  counted: CountedCommand,
  restrictedFlags: readonly TextFlag[],
  message: string,
): RuleVerdict {
  const misplaced = restrictedFlags.some((flag) => isGivenButRefused(counted, flag));
  if (misplaced) {
    return invalidArgumentsFailure(message);
  }
  return success(true);
}

/** Whether `flag` was given to a command that does not accept it. */
function isGivenButRefused(
  counted: CountedCommand,
  flag: TextFlag,
): boolean {
  const isGiven = counted.flags.text[flag] !== undefined;
  return isGiven && refusesFlag(counted.name, flag);
}
