/*
 * Which flags a command may be given: only the flags its table row accepts, never --section
 * together with --object, and always --profile for `profile lint`. The base CLI's wording and
 * order are kept. Pure. `parse.ts` checks this after the operand count; a failure names the flag,
 * and nothing was read or sent, so the caller corrects the flag and runs the command again.
 */
import type { LocalFailure, Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { invalidArguments } from './failures.js';
import { listGivenFlags } from './flags.js';
import type { TextFlag } from './flags.js';
import type { PlacedCommand } from './placed-command.js';
import { lintProfileRequired } from './profile-operands.js';
import { isAccepted, typedName } from './table.js';

/** A rule's verdict: `true` when the command passes it; otherwise the failure naming the flag. */
type RuleVerdict = Result<true, LocalFailure>;

/** One placement rule, checked against the command and its flags. */
type PlacementRule = (placed: PlacedCommand) => RuleVerdict;

/** The placement rules, in the base CLI's order (listed on `checkFlagPlacement`). */
const placementRules: readonly PlacementRule[] = Object.freeze([
  rejectMisplacedProfile,
  requireLintProfile,
  rejectMisplacedIdOrTitle,
  rejectBothScopeFlags,
  rejectMisplacedScopeFlags,
  rejectUnacceptedFlag,
]);

/**
 * The command, unchanged, once every placement rule passes.
 *
 * Fails with `invalid-arguments` for the first broken rule, in this order:
 * 1. `rejectMisplacedProfile`: --profile given to any command but `profile lint`.
 * 2. `requireLintProfile`: `profile lint` given without --profile.
 * 3. `rejectMisplacedIdOrTitle`: --id or --title given to any command but `profile scaffold` and
 *    `recipe admit`.
 * 4. `rejectBothScopeFlags`: --section and --object given together.
 * 5. `rejectMisplacedScopeFlags`: --section or --object given to any command but `read`.
 * 6. `rejectUnacceptedFlag`: any other flag the command does not accept, named as
 *    `--X is not valid with COMMAND`.
 *
 * Flag values are not checked here; `assembly.ts` checks them.
 */
export function checkFlagPlacement(placed: PlacedCommand): Result<PlacedCommand> {
  // `checkNextRule` passes the first failure along unchanged, so later rules are skipped.
  const checked = placementRules.reduce(checkNextRule, success(placed));
  return checked;
}

/** Checks the command against the next rule, or passes an earlier failure on unchanged. */
function checkNextRule(
  checked: Result<PlacedCommand>,
  rule: PlacementRule,
): Result<PlacedCommand> {
  if (!checked.ok) {
    return checked;
  }
  const verdict = rule(checked.value);
  if (!verdict.ok) {
    return verdict;
  }
  return checked;
}

/** Rule 1: --profile only with `profile lint`. */
function rejectMisplacedProfile(placed: PlacedCommand): RuleVerdict {
  return rejectMisplacedFlags(placed, ['profile'], '--profile is only valid with profile lint.');
}

/** Rule 2: `profile lint` needs --profile. Checked before the scope flags, as the base CLI does. */
function requireLintProfile(placed: PlacedCommand): RuleVerdict {
  const lintWithoutProfile = placed.name === 'profile-lint' && placed.flags.profile === undefined;
  if (lintWithoutProfile) {
    return invalidArguments(lintProfileRequired);
  }
  return success(true);
}

/** Rule 3: --id and --title only with `profile scaffold` and `recipe admit`. */
function rejectMisplacedIdOrTitle(placed: PlacedCommand): RuleVerdict {
  return rejectMisplacedFlags(
    placed,
    ['id', 'title'],
    '--id and --title are only valid with profile scaffold or recipe admit.',
  );
}

/** Rule 4: --section and --object never together, whichever command is given them. */
function rejectBothScopeFlags(placed: PlacedCommand): RuleVerdict {
  const bothScopeFlags = placed.flags.section !== undefined && placed.flags.object !== undefined;
  if (bothScopeFlags) {
    return invalidArguments('--section and --object are mutually exclusive for read.');
  }
  return success(true);
}

/** Rule 5: --section and --object only with `read`. */
function rejectMisplacedScopeFlags(placed: PlacedCommand): RuleVerdict {
  return rejectMisplacedFlags(
    placed,
    ['section', 'object'],
    '--section and --object are only valid with read.',
  );
}

/**
 * Rule 6: the first flag the command does not accept fails, in the order the flags were given
 * (`listGivenFlags`).
 */
function rejectUnacceptedFlag(placed: PlacedCommand): RuleVerdict {
  const givenFlags = listGivenFlags(placed.flags);
  const unaccepted = givenFlags.find((flag) => !isAccepted(placed.name, flag));
  if (unaccepted !== undefined) {
    return invalidArguments(`--${unaccepted} is not valid with ${typedName(placed.name)}`);
  }
  return success(true);
}

/**
 * Fails with `message` when any of `restrictedFlags` is given to a command that does not accept
 * it.
 */
function rejectMisplacedFlags(
  placed: PlacedCommand,
  restrictedFlags: readonly TextFlag[],
  message: string,
): RuleVerdict {
  const misplaced = restrictedFlags.some((flag) => isGivenButNotAccepted(placed, flag));
  if (misplaced) {
    return invalidArguments(message);
  }
  return success(true);
}

/** Whether `flag` was given to a command that does not accept it. */
function isGivenButNotAccepted(
  placed: PlacedCommand,
  flag: TextFlag,
): boolean {
  const isGiven = placed.flags[flag] !== undefined;
  return isGiven && !isAccepted(placed.name, flag);
}
