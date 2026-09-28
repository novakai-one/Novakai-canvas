/*
 * One builder per profile command: `profile describe|scaffold|lint` with a checked profile,
 * scaffold's collection ID and title, lint's file, then --out. Pure. Fails with `unknown-profile`,
 * `invalid-arguments`, `source-unavailable` (an empty FILE) or `output-unavailable` (an empty
 * --out); nothing was read or written, so the caller corrects the named argument.
 */
import { collectionId } from '../../contract/brands.js';
import type { CollectionId, FilePath } from '../../contract/brands.js';
import type { ProfileCommand } from '../../contract/records/command.js';
import type { ProfileId } from '../../contract/records/profiles.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import { lintProfileRequiredFailure } from './failures.js';
import type { CommandFlags } from './flags.js';
import { checkOutOption, checkProfile, checkSourceFile } from './values.js';

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
 * `profile describe PROFILE`: the profile, then --out. Fails with `unknown-profile`, then
 * `output-unavailable`.
 */
export function buildProfileDescribeCommand(
  profileText: string,
  flags: CommandFlags,
): Result<ProfileCommand> {
  const profile = checkProfile(profileText);
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
 * `profile scaffold PROFILE --id ID --title TITLE`: the profile, then --id and --title, then
 * --out. Fails with `unknown-profile`, then `invalid-arguments`, then `output-unavailable`.
 */
export function buildProfileScaffoldCommand(
  profileText: string,
  flags: CommandFlags,
): Result<ProfileCommand> {
  const scaffoldTarget = checkScaffoldTarget(profileText, flags);
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
 * `profile lint FILE --profile PROFILE`: the profile, then the file, then --out. Fails with
 * `invalid-arguments` or `unknown-profile`, then `source-unavailable`, then `output-unavailable`.
 */
export function buildProfileLintCommand(
  fileText: string,
  flags: CommandFlags,
): Result<ProfileCommand> {
  const lintTarget = checkLintTarget(fileText, flags.profile);
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
  flags: CommandFlags,
): Result<ScaffoldTarget> {
  const profile = checkProfile(profileText);
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
function checkScaffoldName(flags: CommandFlags): Result<ScaffoldName> {
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
function requireScaffoldText(flags: CommandFlags): Result<ScaffoldText> {
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
  const file = checkSourceFile(fileText);
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
    return lintProfileRequiredFailure();
  }
  return checkProfile(profileText);
}

/** Whether a scaffold flag was given with more than whitespace. */
function hasText(text: string | undefined): text is string {
  return text !== undefined && text.trim() !== '';
}
