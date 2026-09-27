/*
 * The build-spec@1 profile commands: describe, scaffold and lint. Local only; they never reach the
 * service or a workspace. The profile and every argument are already checked. Failures are
 * returned as values; the caller prints them.
 */
import { scaffoldBuildSpec } from './build-spec/starter.js';
import { displayDescriptor, lintReport, lintSummary } from './format.js';
import { lintBuildSpec } from './lint/lint.js';
import type { ProfileCommand } from '../../contract/records/command.js';
import type { ParsedSource } from '../../contract/records/foreign.js';
import type { SemanticInputs } from '../../contract/ports/runtime.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { unsupported } from '../shared/results.js';

/** What the profile commands read and write: local files and the Language parser. */
export interface ProfileDependencies {
  readonly files: LocalFiles;
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
  const saved = await dependencies.files.writeOutput(command.out, source);
  if (!saved.ok) return saved;
  return success(`Written: ${command.out}`);
}

/** Read, parse and lint one file. */
async function lintFile(
  file: FilePath,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const source = await dependencies.files.readSource(file);
  if (!source.ok) return source;
  const parsed = dependencies.semantic.profileParse(source.value);
  if (!parsed.ok) return parsed;
  return lintParsedProfile(parsed.value);
}

/**
 * The passed summary, or `profile-structure` with the summary and every finding. A patch source
 * is `profile-structure` with no findings.
 */
function lintParsedProfile(source: ParsedSource): Result<string> {
  const result = lintBuildSpec(source);
  if (result.status === 'passed') return success(lintSummary(result));
  return failure({
    code: 'profile-structure',
    message: lintReport(result),
    recovery: 'Fix the reported structural findings and rerun profile lint.',
  });
}
