/*
 * Which flags a command may be given: only the flags its table row accepts, never --section
 * together with --object, and always --profile for `profile lint`. The base CLI's wording and
 * order are kept. Pure. `parse.ts` checks this after the operand count; a failure names the flag,
 * and nothing was read or sent, so the caller corrects the flag and runs the command again.
 */
import type { CommandName } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { invalidArguments } from './failures.js';
import type { CommandFlags, TextFlag } from './flags.js';
import type { CountedCommand, PlacedCommand } from './placed-command.js';
import { lintProfileRequired } from './profile-operands.js';
import { isAccepted, typedName } from './table.js';

/** A command and the flags it was given, as text. */
interface FlaggedCommand {
  readonly name: CommandName;
  readonly flags: CommandFlags;
}

/** A rule's verdict: `true` when the flags pass it; otherwise the failure that names the flag. */
type RuleVerdict = Result<true, LocalFailure>;

/** The verdict of a rule the flags break. */
interface BrokenRule {
  readonly ok: false;
  readonly error: LocalFailure;
}

/** One placement rule, checked against the command and its flags. */
type PlacementRule = (flagged: FlaggedCommand) => RuleVerdict;

/** The placement rules, in the base CLI's order. */
const placementRules: readonly PlacementRule[] = Object.freeze([
  onlyWhereAccepted(['profile'], '--profile is only valid with profile lint.'),
  requireLintProfile,
  onlyWhereAccepted(
    ['id', 'title'],
    '--id and --title are only valid with profile scaffold or recipe admit.',
  ),
  rejectBothScopeFlags,
  onlyWhereAccepted(['section', 'object'], '--section and --object are only valid with read.'),
  everyFlagAccepted,
]);

/**
 * The counted command with its flags, once every placement rule passes.
 *
 * Fails with `invalid-arguments` for the first broken rule, in this order:
 * 1. --profile given to any command but `profile lint`.
 * 2. `profile lint` given without --profile.
 * 3. --id or --title given to any command but `profile scaffold` and `recipe admit`.
 * 4. --section and --object given together.
 * 5. --section or --object given to any command but `read`.
 * 6. Any other flag the command does not accept, named as `--X is not valid with COMMAND`.
 *
 * Flag values are not checked here; `operands.ts` checks them.
 */
export function checkFlagPlacement(
  counted: CountedCommand,
  flags: CommandFlags,
): Result<PlacedCommand> {
  const flagged = { name: counted.name, flags };
  const verdicts = placementRules.map((rule) => rule(flagged));
  const firstBroken = verdicts.find(isBroken);
  if (firstBroken !== undefined) {
    return firstBroken;
  }
  return success({ ...counted, flags });
}

/** A rule: giving any flag of `group` to a command that does not accept it fails with `message`. */
function onlyWhereAccepted(
  group: readonly TextFlag[],
  message: string,
): PlacementRule {
  return (flagged) => rejectGroupWhereNotAccepted(flagged, group, message);
}

/** Fails with `message` when any flag of `group` is given to a command that does not accept it. */
function rejectGroupWhereNotAccepted(
  flagged: FlaggedCommand,
  group: readonly TextFlag[],
  message: string,
): RuleVerdict {
  const groupMisplaced = group.some((flag) => isGivenButNotAccepted(flagged, flag));
  if (groupMisplaced) {
    return invalidArguments(message);
  }
  return success(true);
}

/** Whether `flag` was given to a command that does not accept it. */
function isGivenButNotAccepted(
  flagged: FlaggedCommand,
  flag: TextFlag,
): boolean {
  const isGiven = flagged.flags[flag] !== undefined;
  return isGiven && !isAccepted(flagged.name, flag);
}

/** `profile lint` fails without --profile. Checked before the scope flags, as the base CLI does. */
function requireLintProfile(flagged: FlaggedCommand): RuleVerdict {
  const lintWithoutProfile = flagged.name === 'profile-lint' && flagged.flags.profile === undefined;
  if (lintWithoutProfile) {
    return invalidArguments(lintProfileRequired);
  }
  return success(true);
}

/** --section and --object given together fail, whichever command is given them. */
function rejectBothScopeFlags(flagged: FlaggedCommand): RuleVerdict {
  const bothScopeFlags = flagged.flags.section !== undefined && flagged.flags.object !== undefined;
  if (bothScopeFlags) {
    return invalidArguments('--section and --object are mutually exclusive for read.');
  }
  return success(true);
}

/**
 * The last rule: the first flag the command does not accept fails, in the order the flags were
 * given (`collectCommandFlags` keeps Node's order).
 */
function everyFlagAccepted(flagged: FlaggedCommand): RuleVerdict {
  const givenFlags = Object.keys(flagged.flags);
  const notAccepted = givenFlags.find((flag) => !isAccepted(flagged.name, flag));
  if (notAccepted !== undefined) {
    return invalidArguments(`--${notAccepted} is not valid with ${typedName(flagged.name)}`);
  }
  return success(true);
}

/** Whether the rule's verdict is a failure. */
function isBroken(verdict: RuleVerdict): verdict is BrokenRule {
  return !verdict.ok;
}
