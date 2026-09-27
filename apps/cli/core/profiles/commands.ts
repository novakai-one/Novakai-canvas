/*
 * The build-spec@1 profile commands: describe, scaffold and lint. Local only; they never reach the
 * service or a workspace. The profile and every argument are already checked. Failures are
 * returned as values; the caller prints them.
 */
import { scaffoldBuildSpec } from './build-spec/starter.js';
import { displayDescriptor, findingLine } from './format.js';
import { lintBuildSpec } from './lint/lint.js';
import type { ProfileCommand } from '../../contract/records/command.js';
import type { ProfileSource } from '../../contract/records/profiles.js';
import type { RequestFiles, SemanticInputs } from '../../contract/ports/runtime.js';
import type { FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { unsupported } from '../shared/results.js';

/** What the profile commands read and write: local files and the Language parser. */
export interface ProfileDependencies {
  readonly files: Pick<RequestFiles, 'source' | 'output'>;
  readonly semantic: Pick<SemanticInputs, 'profileParse'>;
}

/**
 * Runs one profile command and returns its text. Fails with `output-unavailable` (scaffold's
 * --out), `source-unavailable` or `source-too-large` (lint's file), `invalid-source` (Language
 * rejected it) or `profile-structure` (lint findings).
 */
export async function executeProfile(
  command: ProfileCommand,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  switch (command.name) {
    case 'profile-describe':
      return success(displayDescriptor());
    case 'profile-scaffold':
      return scaffold(command, dependencies);
    case 'profile-lint':
      return lintFile(command.file, dependencies);
    default:
      return unsupported(command);
  }
}

/** The starter named with the checked collection ID and title; written to --out when given. */
async function scaffold(
  command: Extract<ProfileCommand, { readonly name: 'profile-scaffold' }>,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const source = scaffoldBuildSpec(command.collection, command.title);
  if (command.out === undefined) return success(source);
  const saved = await dependencies.files.output(command.out, source);
  if (!saved.ok) return saved;
  return success(`Written: ${command.out}`);
}

/** Read, parse and lint one file. */
async function lintFile(
  file: FilePath,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const source = await dependencies.files.source(file);
  if (!source.ok) return source;
  const parsed = dependencies.semantic.profileParse(source.value.source);
  if (!parsed.ok) return parsed;
  return lintParsedProfile(parsed.value);
}

/** The lint summary, or `profile-structure` listing every finding. */
function lintParsedProfile(source: ProfileSource): Result<string> {
  const result = lintBuildSpec(source);
  return result.valid
    ? success(result.summary)
    : failure({
        code: 'profile-structure',
        message: `${result.summary}\n${result.findings.map(findingLine).join('\n')}`,
        recovery: 'Fix the reported structural findings and rerun profile lint.',
      });
}
