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
import type { CollectionId, FilePath, ProfileId } from '../../contract/brands.js';
import type { ProfileCommand } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
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

/** Checks the profile, then `--id` and `--title`. */
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

/** Checks `--id` and `--title` were typed, then that `--id` is a valid collection ID. */
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

/** Checks that `--id`, then `--title`, were typed and aren't blank. */
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

/** Checks one scaffold flag was typed and isn't blank, and keeps its text as typed. */
function requireScaffoldFlag(
  flagText: string | undefined,
  flag: ScaffoldFlag,
): Result<string> {
  if (!hasText(flagText)) {
    return missingScaffoldFlagFailure(flag);
  }
  return success(flagText);
}

/** Checks the scaffold's `--id` is a valid collection ID, such as `my-plan`. */
function checkScaffoldId(idText: string): Result<CollectionId> {
  const collection = collectionId.safeParse(idText);
  if (!collection.success) {
    return badScaffoldIdFailure();
  }
  return success(collection.data);
}

/** Checks the `--profile` for `profile lint`, then the path of the file to check. */
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
 * Checks the `--profile` for `profile lint`. (A missing `--profile` was already refused by rule 2
 * in `accepted-flags.ts`; the check here only keeps the types honest.)
 */
function checkLintProfile(profileText: string | undefined): Result<ProfileId> {
  if (profileText === undefined) {
    return lintWithoutProfileFlagFailure();
  }
  return checkProfileId(profileText);
}

/** Whether a scaffold flag was typed with text that isn't only spaces, tabs or line breaks. */
function hasText(flagText: string | undefined): flagText is string {
  return flagText !== undefined && flagText.trim() !== '';
}

/** Makes the mistake for `--id` or `--title` missing or blank (`invalid-arguments`). */
function missingScaffoldFlagFailure(flag: ScaffoldFlag): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message: `Scaffold requires --${flag}.` });
}

/** Makes the mistake for a scaffold `--id` that isn't a collection ID (`invalid-arguments`). */
function badScaffoldIdFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Scaffold --id must be a simple collection ID.',
  });
}
