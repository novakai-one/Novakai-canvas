/*
 * The build-spec@1 profile commands: describe, scaffold and lint. Local only; they never reach the
 * service or a workspace. Failures are returned as values; the caller prints them.
 */
import { buildSpecProfile } from './build-spec/descriptor.js';
import { scaffoldBuildSpec } from './build-spec/starter.js';
import { displayDescriptor, findingLine } from './format.js';
import { lintBuildSpec } from './lint/lint.js';
import type { Command } from '../../contract/records/command.js';
import type { SemanticInputs } from '../../contract/ports/runtime.js';
import type { RequestFiles } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

export interface ProfileDependencies {
  readonly files: Pick<RequestFiles, 'source' | 'output'>;
  readonly semantic: Pick<SemanticInputs, 'profileParse'>;
}

function profileError(target: string): Result<string> {
  return failure({
    code: 'unknown-profile',
    message: `Unknown profile: ${target}`,
    recovery: 'Use build-spec@1.',
  });
}

function validText(
  value: string | undefined,
  label: string,
): Result<string> {
  if (value === undefined || value.trim() === '')
    return failure({ code: 'invalid-arguments', message: `Scaffold requires --${label}.` });
  return success(value);
}

export async function executeProfile(
  command: Command,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const handler = profileHandlers[command.name];
  return handler === undefined
    ? failure({ code: 'invalid-command', message: `Unsupported profile command: ${command.name}` })
    : handler(command, dependencies);
}

type ProfileHandler = (
  command: Command,
  dependencies: ProfileDependencies,
) => Promise<Result<string>>;

const profileHandlers: Partial<Record<Command['name'], ProfileHandler>> = {
  'profile-describe': describeProfile,
  'profile-scaffold': scaffoldProfile,
  'profile-lint': lintProfile,
};

function describeProfile(
  command: Command,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  void dependencies;
  const result: Result<string> =
    command.target === buildSpecProfile.id
      ? success(displayDescriptor())
      : profileError(command.target);
  return Promise.resolve(result);
}

async function scaffoldProfile(
  command: Command,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const profile = requireProfile(command.target);
  return profile.ok ? scaffoldWithProfile(command, dependencies) : Promise.resolve(profile);
}

function scaffoldWithProfile(
  command: Command,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const id = validText(command.preset?.id, 'id');
  return id.ok ? scaffoldWithId(command, dependencies, id.value) : Promise.resolve(id);
}

function scaffoldWithId(
  command: Command,
  dependencies: ProfileDependencies,
  id: string,
): Promise<Result<string>> {
  const title = validText(command.preset?.title, 'title');
  return title.ok ? writeScaffold(command, dependencies, id, title.value) : Promise.resolve(title);
}

async function writeScaffold(
  command: Command,
  dependencies: ProfileDependencies,
  id: string,
  title: string,
): Promise<Result<string>> {
  const validId = /^[-a-zA-Z0-9_]+$/.test(id);
  if (!validId)
    return Promise.resolve(
      failure({
        code: 'invalid-arguments',
        message: 'Scaffold --id must be a simple collection ID.',
      }),
    );
  const source = scaffoldBuildSpec(id, title);
  return command.output === null
    ? Promise.resolve(success(source))
    : writeScaffoldFile(command.output, source, dependencies);
}

async function writeScaffoldFile(
  output: string,
  source: string,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const saved = await dependencies.files.output(output, source);
  return saved.ok ? success(`Written: ${output}`) : saved;
}

async function lintProfile(
  command: Command,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const profile = requireProfile(command.profile ?? 'missing');
  return profile.ok ? lintSourceFile(command.target, dependencies) : Promise.resolve(profile);
}

async function lintSourceFile(
  target: string,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const source = await dependencies.files.source(target);
  return source.ok ? parseProfileSource(source.value, dependencies) : source;
}

function parseProfileSource(
  source: string,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const parsed = dependencies.semantic.profileParse(source);
  return parsed.ok ? Promise.resolve(lintParsedProfile(parsed.value)) : Promise.resolve(parsed);
}

type ParsedProfile =
  ReturnType<SemanticInputs['profileParse']> extends Result<infer Value> ? Value : never;

function lintParsedProfile(source: ParsedProfile): Result<string> {
  const result = lintBuildSpec(source);
  return result.valid
    ? success(result.summary)
    : failure({
        code: 'profile-structure',
        message: `${result.summary}\n${result.findings.map(findingLine).join('\n')}`,
        recovery: 'Fix the reported structural findings and rerun profile lint.',
      });
}

function requireProfile(value: string): Result<true> {
  return value === buildSpecProfile.id
    ? success(true)
    : failure({
        code: 'unknown-profile',
        message: `Unknown profile: ${value}`,
        recovery: 'Use build-spec@1.',
      });
}

export function isProfileCommand(command: Command): boolean {
  return (
    command.name === 'profile-describe' ||
    command.name === 'profile-scaffold' ||
    command.name === 'profile-lint'
  );
}
