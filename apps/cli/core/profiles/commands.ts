/*
 * The profile commands: describe, scaffold and lint, each answering with its text. Language owns
 * the profiles; these commands read the lint file, call Language and format the answer. Local
 * only; they never reach the service or a workspace. The profile and every argument are already
 * checked; `core/commands/dispatch.ts` writes the text to --out. Failures are returned as values;
 * the caller prints them.
 */
import { displayDescriptor, lintReport, lintSummary } from './format.js';
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

/** What the profile commands read: the lint file, the Language parser and the profiles. */
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
 * Runs one profile command and returns its text: the descriptor, the starter named with the
 * checked collection ID and title, or the lint summary. Fails with `source-unavailable` or
 * `source-too-large` (lint's file), `invalid-source` (Language rejected it) or `profile-structure`
 * (lint findings).
 */
export function answerProfile(
  command: ProfileCommand,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const profiles = dependencies.profiles;
  switch (command.name) {
    case 'profile-describe':
      return Promise.resolve(success(displayDescriptor(profiles.describe(command.profile))));
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
  if (result.status === 'passed') return success(lintSummary(profile, result));
  return failure({
    code: 'profile-structure',
    message: lintReport(profile, result),
    recovery: 'Fix the reported structural findings and rerun profile lint.',
  });
}
