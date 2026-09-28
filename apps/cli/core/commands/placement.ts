/*
 * Where a flag may be given: only to a command whose table row reads it. --profile, --id, --title,
 * --section and --object keep the base CLI's own wording and order. Pure. `parse.ts` checks this
 * after the operand count; a failure names the misplaced flag, and nothing was read or sent, so
 * the caller corrects the flag and runs the command again.
 */
import type { CommandName } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { combined } from '../shared/results.js';
import type { CommandFlags, TextFlag } from './flags.js';
import { lintProfileRequired } from './profile-operands.js';
import { isAccepted, spokenName } from './table.js';

/** A command and the flags it was given, as text. */
export interface GivenFlags {
  readonly name: CommandName;
  readonly flags: CommandFlags;
}

/** A placement rule: success when the command may be given these flags; otherwise why not. */
type PlacementRule = (given: GivenFlags) => Result<true>;

/** The placement rules, in the base CLI's order. */
const placementRules: readonly PlacementRule[] = Object.freeze([
  onlyWhereRead(['profile'], '--profile is only valid with profile lint.'),
  lintNeedsProfile,
  onlyWhereRead(
    ['id', 'title'],
    '--id and --title are only valid with profile scaffold or recipe admit.',
  ),
  scopeFlagsExclusive,
  onlyWhereRead(['section', 'object'], '--section and --object are only valid with read.'),
  everyFlagRead,
]);

/**
 * Checks that the command reads every flag it was given.
 *
 * Fails with `invalid-arguments` for the first broken rule, in this order:
 * 1. --profile given to any command but `profile lint`.
 * 2. `profile lint` given without --profile.
 * 3. --id or --title given to any command but `profile scaffold` and `recipe admit`.
 * 4. --section and --object given together.
 * 5. --section or --object given to any command but `read`.
 * 6. Any other flag the command does not read, named as `--X is not valid with COMMAND`.
 *
 * Flag values are not checked here; `operands.ts` checks them.
 */
export function checkPlacement(given: GivenFlags): Result<true> {
  const verdicts = placementRules.map((rule) => rule(given));
  // `combined` returns the first failure unchanged, so the earliest broken rule is reported.
  const placed = combined(verdicts);
  if (!placed.ok) return placed;
  return success(true);
}

/** A rule: giving any flag of `group` to a command that does not read it fails with `message`. */
function onlyWhereRead(
  group: readonly TextFlag[],
  message: string,
): PlacementRule {
  return (given) => checkGroup(given, group, message);
}

/** Fails with `message` when any flag of `group` is given to a command that does not read it. */
function checkGroup(
  given: GivenFlags,
  group: readonly TextFlag[],
  message: string,
): Result<true> {
  const groupMisplaced = group.some((flag) => isGivenButUnread(given, flag));
  if (groupMisplaced) return misplaced(message);
  return success(true);
}

/** `profile lint` needs --profile. Checked before the read scope flags, as the base CLI does. */
function lintNeedsProfile(given: GivenFlags): Result<true> {
  const lintWithoutProfile = given.name === 'profile-lint' && given.flags.profile === undefined;
  if (lintWithoutProfile) return misplaced(lintProfileRequired);
  return success(true);
}

/** At most one of --section and --object, whichever command is given them. */
function scopeFlagsExclusive(given: GivenFlags): Result<true> {
  const bothScopes = given.flags.section !== undefined && given.flags.object !== undefined;
  if (bothScopes) return misplaced('--section and --object are mutually exclusive for read.');
  return success(true);
}

/** The last rule: the first flag, in the order given, that the command does not read. */
function everyFlagRead(given: GivenFlags): Result<true> {
  const givenFlags = Object.keys(given.flags);
  const unread = givenFlags.find((flag) => !isAccepted(given.name, flag));
  if (unread === undefined) return success(true);
  return misplaced(`--${unread} is not valid with ${spokenName(given.name)}`);
}

/** Whether `flag` was given to a command that does not read it. */
function isGivenButUnread(
  given: GivenFlags,
  flag: TextFlag,
): boolean {
  const isGiven = given.flags[flag] !== undefined;
  return isGiven && !isAccepted(given.name, flag);
}

/** A flag given where it is not read: `invalid-arguments`. */
function misplaced(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}
