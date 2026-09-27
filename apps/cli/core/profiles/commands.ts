import { buildSpecProfile, scaffoldBuildSpec } from './build-spec/starter.js';
import { lintBuildSpec } from './lint/lint.js';
import type { Command } from '../../contract/records/command.js';
import type { SemanticInputs } from '../../contract/ports/runtime.js';
import type { RequestFiles } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { ProfileFinding } from '../../contract/records/profiles.js';

export interface ProfileDependencies {
  readonly files: Pick<RequestFiles, 'source' | 'output'>;
  readonly semantic: Pick<SemanticInputs, 'profileParse'>;
}

function profileError(target: string): Result<string> {
  return failure('unknown-profile', `Unknown profile: ${target}`, 'Use build-spec@1.');
}

function validText(
  value: string | undefined,
  label: string,
): Result<string> {
  if (value === undefined || value.trim() === '')
    return failure('invalid-arguments', `Scaffold requires --${label}.`);
  return { ok: true, value };
}

function findingLine(finding: ProfileFinding): string {
  return `PROFILE ${finding.path} ${finding.span.start.line}:${finding.span.start.column} ${finding.message}`;
}

function displayDescriptor(): string {
  return [
    `${buildSpecProfile.id} — ${buildSpecProfile.description}`,
    '',
    'Commands:',
    ...Object.values(buildSpecProfile.commands).map((command) => `  ${command}`),
    '',
    'Required logical documents:',
    ...buildSpecProfile.slots.map(
      (slot) => `  ${slot.order}. ${slot.id} (${slot.modes.join('|')}) — ${slot.description}`,
    ),
    `  5.N appendix (${buildSpecProfile.appendix.modes.join('|')}) — ${buildSpecProfile.appendix.description}`,
    '',
    'Structural conventions:',
    ...buildSpecProfile.conventions.map((convention) => `  ${convention}`),
    '',
    ...buildSpecProfile.notes.map((note) => `Note: ${note}`),
  ].join('\n');
}

export async function executeProfile(
  command: Command,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const handler = profileHandlers[command.name];
  return handler === undefined
    ? failure('invalid-command', `Unsupported profile command: ${command.name}`)
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
      ? { ok: true, value: displayDescriptor() }
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
      failure('invalid-arguments', 'Scaffold --id must be a simple collection ID.'),
    );
  const source = scaffoldBuildSpec(id, title);
  return command.output === null
    ? Promise.resolve({ ok: true, value: source })
    : writeScaffoldFile(command.output, source, dependencies);
}

async function writeScaffoldFile(
  output: string,
  source: string,
  dependencies: ProfileDependencies,
): Promise<Result<string>> {
  const saved = await dependencies.files.output(output, source);
  return saved.ok ? { ok: true, value: `Written: ${output}` } : saved;
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
    ? { ok: true, value: result.summary }
    : failure(
        'profile-structure',
        `${result.summary}\n${result.findings.map(findingLine).join('\n')}`,
        'Fix the reported structural findings and rerun profile lint.',
      );
}

function requireProfile(value: string): Result<true> {
  return value === buildSpecProfile.id
    ? { ok: true, value: true }
    : failure('unknown-profile', `Unknown profile: ${value}`, 'Use build-spec@1.');
}

export function isProfileCommand(command: Command): boolean {
  return (
    command.name === 'profile-describe' ||
    command.name === 'profile-scaffold' ||
    command.name === 'profile-lint'
  );
}
