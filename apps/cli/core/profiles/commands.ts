/*
 * Why this file exists
 *
 * A profile is a set of rules a collection follows, such as `build-spec@1`. Three commands help an
 * agent follow one: `profile describe` prints its rules, `profile scaffold` prints a starter
 * source, and `profile lint plan.canvas --profile build-spec@1` checks a file against it.
 *
 * This file runs those three and gives back the text each prints. Language owns the profiles and
 * does the real work. This file only reads the file `lint` checks; it never talks to the service.
 * Each step gives back a `Result` (see `contract/errors.ts`).
 */
import { formatDescriptor, formatLintReport, formatLintSummary } from './format.js';
import type { ProfileCommand } from '../../contract/records/command.js';
import type { ParsedSource } from '../../contract/records/foreign.js';
import type { CollectionProfiles } from '../../contract/ports/collection-profiles.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { SourceParser } from '../../contract/ports/source-parser.js';
import type { ProfileId } from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { parseSource } from '../shared/parse-source.js';
import { unsupported } from '../shared/results.js';

/**
 * The tools the profile commands use: `files` reads the file `lint` checks, `language` parses it,
 * and `profiles` is Language's profiles and their rules.
 */
export interface ProfileDependencies {
  readonly files: Pick<LocalFiles, 'readSource'>;
  readonly language: SourceParser;
  readonly profiles: CollectionProfiles;
}

/** `profile scaffold`: names the starter with a collection ID and title. */
type ScaffoldCommand = Extract<ProfileCommand, { readonly name: 'profile-scaffold' }>;

/** `profile lint`: the one profile command that reads a file. */
type LintCommand = Extract<ProfileCommand, { readonly name: 'profile-lint' }>;

/** What to do next after a lint that did not pass. */
const profileStructureRecovery = 'Fix the reported structural findings and rerun profile lint.';

/**
 * Runs one profile command and gives back the text to print: the profile's rules (`describe`),
 * a starter source (`scaffold`), or the one-line lint summary (`lint`).
 * The mistakes it can find, all from `lint`: a file that can't be read or parsed, or a file that
 * breaks the profile's rules or is only a patch (`profile-structure`, listing each broken rule).
 */
export function answerProfileCommand(
  command: ProfileCommand,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  switch (command.name) {
    case 'profile-describe':
      return Promise.resolve(describeProfile(command.profile, dependencies.profiles));
    case 'profile-scaffold':
      return Promise.resolve(scaffoldStarter(command, dependencies.profiles));
    case 'profile-lint':
      return lintFile(command, dependencies);
    default:
      return Promise.resolve(unsupported(command));
  }
}

/**
 * Writes the profile's rules as `profile describe` prints them. It can't fail; it answers with a
 * `Result` so all three profile commands answer the same way.
 */
function describeProfile(
  profile: ProfileId,
  profiles: CollectionProfiles,
): Result<string> {
  const descriptor = profiles.describe(profile);
  const description = formatDescriptor(descriptor);
  return success(description);
}

/**
 * Writes the profile's starter source, named with the typed collection ID and title. It can't
 * fail; it answers with a `Result` like the other profile commands.
 */
function scaffoldStarter(
  command: ScaffoldCommand,
  profiles: CollectionProfiles,
): Result<string> {
  const starter = { collection: command.collection, title: command.title };
  const starterSource = profiles.scaffold(command.profile, starter);
  return success(starterSource);
}

/** Reads the file, parses it with Language, then checks it against the profile. */
async function lintFile(
  command: LintCommand,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const sourceText = await dependencies.files.readSource(command.file);
  if (!sourceText.ok) {
    return sourceText;
  }
  const parsedSource = parseSource(dependencies.language, sourceText.value);
  if (!parsedSource.ok) {
    return parsedSource;
  }
  return lintParsedSource(command.profile, parsedSource.value, dependencies.profiles);
}

/**
 * Checks the parsed source against the profile, and gives back the summary line when it passes.
 * A source that breaks a rule, or is only a patch, is a `profile-structure` mistake.
 */
function lintParsedSource(
  profile: ProfileId,
  source: ParsedSource,
  profiles: CollectionProfiles,
): Result<string> {
  const lintOutcome = profiles.lint(profile, source);
  if (lintOutcome.status !== 'passed') {
    const lintReport = formatLintReport(profile, lintOutcome);
    return profileStructureFailure(lintReport);
  }
  const summary = formatLintSummary(profile, lintOutcome);
  return success(summary);
}

/** Makes the mistake for a lint that did not pass, with the report as its message. */
function profileStructureFailure(lintReport: string): Result<never, LocalFailure> {
  return failure({
    code: 'profile-structure',
    message: lintReport,
    recovery: profileStructureRecovery,
  });
}
