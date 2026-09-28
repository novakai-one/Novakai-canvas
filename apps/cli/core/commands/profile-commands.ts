/*
 * Why this file exists
 *
 * A profile is a set of rules a collection can follow, such as `build-spec@1`. Three commands use
 * one, and run on this machine: `profile describe`, `profile scaffold` and `profile lint`. For
 * example, `pnpm canvas profile lint my-plan.canvas --profile build-spec@1` checks that file.
 *
 * This file checks what was typed for each one, and builds its `ProfileCommand`. It never reads or
 * writes a file.
 */
import { collectionId } from '../../contract/brands.js';
import type { CollectionId, FilePath } from '../../contract/brands.js';
import type { ProfileCommand } from '../../contract/records/command.js';
import type { ProfileId } from '../../contract/records/profiles.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import { lintWithoutProfileFlagFailure } from './failures.js';
import type { FlagTextAsTyped } from './flags.js';
import { checkFilePath, checkOutOption, checkProfileId } from './values.js';

/** A flag `profile scaffold` requires: --id or --title. */
type ScaffoldFlag = 'id' | 'title';

/** --id and --title as given, each not blank. */
interface ScaffoldText {
  readonly idText: string;
  readonly title: string;
}

/** The scaffold's checked --id (its collection ID) and --title. */
interface ScaffoldName {
  readonly collection: CollectionId;
  readonly title: string;
}

/** What `profile scaffold` makes: a scaffold of the profile, with this collection ID and title. */
interface ScaffoldTarget extends ScaffoldName {
  readonly profile: ProfileId;
}

/** What `profile lint` checks: the FILE, against the --profile. */
interface LintTarget {
  readonly profile: ProfileId;
  readonly file: FilePath;
}

/**
 * Builds `profile describe`, which prints the rules a profile asks a collection to follow.
 *
 * `typedProfileId` is the profile as typed, such as `build-spec@1`.
 * The mistakes it can find: an unknown profile, or an empty `--out` path.
 */
export function buildProfileDescribeCommand(
  typedProfileId: string,
  flags: FlagTextAsTyped,
): Result<ProfileCommand> {
  const profile = checkProfileId(typedProfileId);
  if (!profile.ok) {
    return profile;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name: 'profile-describe', profile: profile.value, ...outOption.value });
}

/**
 * Builds `profile scaffold`, which makes the starting text of a collection that follows a profile.
 *
 * `profile scaffold build-spec@1 --id my-plan --title "My plan"`.
 * The mistakes it can find: an unknown profile, `--id` or `--title` missing or bad, or an empty
 * `--out` path.
 */
export function buildProfileScaffoldCommand(
  typedProfileId: string,
  flags: FlagTextAsTyped,
): Result<ProfileCommand> {
  const scaffoldTarget = checkScaffoldTarget(typedProfileId, flags);
  if (!scaffoldTarget.ok) {
    return scaffoldTarget;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name: 'profile-scaffold', ...scaffoldTarget.value, ...outOption.value });
}

/**
 * Builds `profile lint`, which checks that a collection file follows a profile's rules.
 *
 * `typedFilePath` is the file's path as typed. The profile comes from `--profile`.
 * The mistakes it can find: an unknown `--profile`, an empty file path, or an empty `--out` path.
 */
export function buildProfileLintCommand(
  typedFilePath: string,
  flags: FlagTextAsTyped,
): Result<ProfileCommand> {
  const lintTarget = checkLintTarget(typedFilePath, flags.profile);
  if (!lintTarget.ok) {
    return lintTarget;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name: 'profile-lint', ...lintTarget.value, ...outOption.value });
}

/** The profile, then --id and --title. Fails with `unknown-profile`, then `invalid-arguments`. */
function checkScaffoldTarget(
  profileText: string,
  flags: FlagTextAsTyped,
): Result<ScaffoldTarget> {
  const profile = checkProfileId(profileText);
  if (!profile.ok) {
    return profile;
  }
  const scaffoldName = checkScaffoldName(flags);
  if (!scaffoldName.ok) {
    return scaffoldName;
  }
  return success({ profile: profile.value, ...scaffoldName.value });
}

/**
 * --id and --title, each given and not blank, then --id as a collection ID. Fails with
 * `invalid-arguments`.
 */
function checkScaffoldName(flags: FlagTextAsTyped): Result<ScaffoldName> {
  const scaffoldText = requireScaffoldText(flags);
  if (!scaffoldText.ok) {
    return scaffoldText;
  }
  const collection = checkScaffoldId(scaffoldText.value.idText);
  if (!collection.ok) {
    return collection;
  }
  return success({ collection: collection.value, title: scaffoldText.value.title });
}

/** --id, then --title, each given and not blank. Fails with `invalid-arguments` naming the flag. */
function requireScaffoldText(flags: FlagTextAsTyped): Result<ScaffoldText> {
  const idText = requireScaffoldFlag(flags.id, 'id');
  if (!idText.ok) {
    return idText;
  }
  const title = requireScaffoldFlag(flags.title, 'title');
  if (!title.ok) {
    return title;
  }
  return success({ idText: idText.value, title: title.value });
}

/** A scaffold flag's text, kept as given. Fails with `invalid-arguments` when missing or blank. */
function requireScaffoldFlag(
  text: string | undefined,
  flag: ScaffoldFlag,
): Result<string> {
  if (!hasText(text)) {
    return failure({ code: 'invalid-arguments', message: `Scaffold requires --${flag}.` });
  }
  return success(text);
}

/** The scaffold's --id as a collection ID, in Model's grammar. Fails with `invalid-arguments`. */
function checkScaffoldId(idText: string): Result<CollectionId> {
  return checked(collectionId, idText, {
    code: 'invalid-arguments',
    message: 'Scaffold --id must be a simple collection ID.',
  });
}

/** --profile, then the FILE. Fails as `checkLintProfile` does, then with `source-unavailable`. */
function checkLintTarget(
  fileText: string,
  profileText: string | undefined,
): Result<LintTarget> {
  const profile = checkLintProfile(profileText);
  if (!profile.ok) {
    return profile;
  }
  const file = checkFilePath(fileText);
  if (!file.ok) {
    return file;
  }
  return success({ profile: profile.value, file: file.value });
}

/**
 * lint's --profile. Fails with `unknown-profile`; a missing --profile is `invalid-arguments`, which
 * rule 2 in `accepted-flags.ts` already reported, so this case only keeps the check total.
 */
function checkLintProfile(profileText: string | undefined): Result<ProfileId> {
  if (profileText === undefined) {
    return lintWithoutProfileFlagFailure();
  }
  return checkProfileId(profileText);
}

/** Whether a scaffold flag was given with more than whitespace. */
function hasText(text: string | undefined): text is string {
  return text !== undefined && text.trim() !== '';
}
