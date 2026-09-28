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
import type { Result } from '../../contract/errors.js';
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
  const profiles = dependencies.profiles;
  switch (command.name) {
    case 'profile-describe':
      return Promise.resolve(success(formatDescriptor(profiles.describe(command.profile))));
    case 'profile-scaffold':
      return Promise.resolve(success(scaffoldStarter(command, profiles)));
    case 'profile-lint':
      return lintFile(command, dependencies);
    default:
      return Promise.resolve(unsupported(command));
  }
}

/** The profile's starter source, named with the command's collection ID and title. */
function scaffoldStarter(
  command: ScaffoldCommand,
  profiles: CollectionProfiles,
): string {
  const starter = { collection: command.collection, title: command.title };
  return profiles.scaffold(command.profile, starter);
}

/** Read, parse and lint one file. */
async function lintFile(
  command: LintCommand,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const source = await dependencies.files.readSource(command.file);
  if (!source.ok) return source;
  const parsed = parseSource(dependencies.language, source.value);
  if (!parsed.ok) return parsed;
  return lintParsedProfile(command.profile, parsed.value, dependencies.profiles);
}

/**
 * The passed summary, or `profile-structure` with the summary and every finding. A patch source
 * is `profile-structure` with no findings.
 */
function lintParsedProfile(
  profile: ProfileId,
  source: ParsedSource,
  profiles: CollectionProfiles,
): Result<string> {
  const result = profiles.lint(profile, source);
  if (result.status === 'passed') return success(formatLintSummary(profile, result));
  return failure({
    code: 'profile-structure',
    message: formatLintReport(profile, result),
    recovery: 'Fix the reported structural findings and rerun profile lint.',
  });
}
