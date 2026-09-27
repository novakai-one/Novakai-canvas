import { parseArgs } from 'node:util';
import { commandName } from '../../contract/records/command.js';
import type { CliOptions, Command } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { z } from 'zod';
const mode = z.enum(['create', 'replace', 'patch']);
const revision = z
  .string()
  .regex(/^[0-9]+$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
/** The flag values the command grammar reads. */
interface CommandFlags {
  readonly preset?: Command['preset'];
  readonly revision?: string;
  readonly mode: string;
  readonly request?: string;
  readonly out?: string;
  readonly profile?: string;
  readonly section?: string;
  readonly object?: string;
}
/** Flags are parsed by Node; unknown flags, extra operands and malformed revision values fail before any file/network I/O. */
export function readArguments(
  args: readonly string[],
  defaultWorkspace: string,
): Result<CliOptions> {
  try {
    const parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      tokens: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        server: { type: 'string', default: 'http://127.0.0.1:5174' },
        workspace: { type: 'string', default: defaultWorkspace },
        revision: { type: 'string' },
        mode: { type: 'string', default: 'create' },
        request: { type: 'string' },
        out: { type: 'string' },
        id: { type: 'string' },
        version: { type: 'string' },
        family: { type: 'string' },
        title: { type: 'string' },
        namespace: { type: 'string' },
        profile: { type: 'string' },
        section: { type: 'string' },
        object: { type: 'string' },
      },
    });
    const command = readCommand(
      commandOperands(parsed.values.help, parsed.positionals),
      {
        ...parsed.values,
        preset: Object.fromEntries(
          Object.entries({
            id: parsed.values.id,
            version: parsed.values.version,
            family: parsed.values.family,
            title: parsed.values.title,
            namespace: parsed.values.namespace,
          }).filter(([, value]) => value !== undefined),
        ),
      },
      parsed.tokens,
    );
    if (!command.ok) return command;
    return success({
      command: command.value,
      server: parsed.values.server,
      workspaceDirectory: parsed.values.workspace,
    });
  } catch {
    return failure({
      code: 'invalid-arguments',
      message: 'Unknown or malformed CLI flag',
      recovery:
        'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.',
    });
  }
}
/** Preserve command intent explicitly; a preview's mode is independent of whether a source parses as a full document or patch. */
function readCommand(
  positionals: readonly string[],
  flags: CommandFlags,
  tokens: readonly { readonly kind: string; readonly name?: string }[],
): Result<Command> {
  if (duplicateScopeFlag(tokens))
    return invalidArguments('Each read scope flag may be provided only once.');
  const parsed = commandName.safeParse(positionals[0]);
  if (!parsed.success)
    return failure({
      code: 'invalid-command',
      message: 'Choose a supported canvas or profile command',
    });
  return operands(parsed.data, positionals, flags);
}
/** Operands cannot be silently ignored: commands accept exactly the arguments shown in their help vocabulary. */
function operands(
  name: Command['name'],
  positionals: readonly string[],
  flags: CommandFlags,
): Result<Command> {
  const count = ['help', 'describe', 'list'].includes(name) ? 1 : 2;
  if (positionals.length !== count)
    return invalidArguments(`${name} requires ${count - 1} operand(s)`);
  return fields(name, positionals[1] ?? '', flags);
}
/** Value validation returns named input errors instead of allowing NaN or negative revisions into preconditions. */
function fields(
  name: Command['name'],
  target: string,
  flags: CommandFlags,
): Result<Command> {
  const invalid = profileFlagFailure(name, flags) ?? readScopeFailure(name, flags);
  if (invalid !== undefined) return invalid;
  return validFields(name, target, flags);
}

function validFields(
  name: Command['name'],
  target: string,
  flags: CommandFlags,
): Result<Command> {
  const checked = validatedMode(name, flags.mode);
  if (!checked.ok) return checked;
  const scope = readScope(name, flags);
  return versioned(
    {
      name,
      target,
      mode: checked.value,
      request: flags.request ?? null,
      output: flags.out ?? null,
      preset: flags.preset,
      profile: flags.profile,
      ...(scope === undefined ? {} : { scope }),
    },
    flags.revision,
  );
}

function readScopeFailure(
  name: Command['name'],
  flags: { readonly section?: string; readonly object?: string },
): Result<Command> | undefined {
  const selected = [flags.section, flags.object].filter((value) => value !== undefined);
  if (selected.length > 1)
    return invalidArguments('--section and --object are mutually exclusive for read.');
  return selected.length === 0 ? undefined : invalidReadScope(name, selected[0]);
}

function invalidReadScope(
  name: Command['name'],
  selected: string | undefined,
): Result<Command> | undefined {
  if (name !== 'read') return invalidArguments('--section and --object are only valid with read.');
  return invalidScopeId(selected);
}

function invalidScopeId(selected: string | undefined): Result<Command> | undefined {
  if (selected === undefined || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(selected))
    return invalidArguments('Read scope IDs must be non-empty canonical IDs.');
  return undefined;
}

function duplicateScopeFlag(
  tokens: readonly { readonly kind: string; readonly name?: string }[],
): boolean {
  const names = tokens.flatMap((token) =>
    token.kind === 'option' && (token.name === 'section' || token.name === 'object')
      ? [token.name]
      : [],
  );
  return names.some((name) => names.indexOf(name) !== names.lastIndexOf(name));
}

function validatedMode(
  name: Command['name'],
  fallback: string,
): Result<Command['mode']> {
  const selected = ['create', 'replace', 'patch'].includes(name) ? name : fallback;
  const checked = mode.safeParse(selected);
  return checked.success
    ? success(checked.data)
    : failure({ code: 'invalid-mode', message: 'Mode must be create, replace or patch' });
}

function readScope(
  name: Command['name'],
  flags: { readonly section?: string; readonly object?: string },
): Command['scope'] {
  if (name !== 'read') return undefined;
  return scopeValue(flags);
}

function scopeValue(flags: {
  readonly section?: string;
  readonly object?: string;
}): Command['scope'] {
  if (flags.section !== undefined) return { kind: 'section', id: flags.section };
  if (flags.object !== undefined) return { kind: 'object', id: flags.object };
  return { kind: 'all' };
}
/** A revision is optional for read/create commands; semantic admission makes it mandatory for existing diagram changes. */
function versioned(
  command: Omit<Command, 'revision'>,
  input: string | undefined,
): Result<Command> {
  if (input === undefined) return success({ ...command, revision: null });
  const checked = revision.safeParse(input);
  if (!checked.success)
    return failure({
      code: 'invalid-revision',
      message: 'Revision must be a non-negative safe integer',
    });
  return success({ ...command, revision: checked.data });
}

/** Help is a local command and never needs a running workspace. */
function commandOperands(
  help: boolean | undefined,
  positionals: readonly string[],
): readonly string[] {
  if (help) return ['help'];
  const family = { theme: 'theme', recipe: 'recipe', profile: 'profile' }[positionals[0] ?? ''];
  if (family !== undefined) return [`${family}-${positionals[1]}`, ...positionals.slice(2)];
  return positionals;
}

function profileFlagFailure(
  name: Command['name'],
  flags: { readonly preset?: Command['preset']; readonly profile?: string },
): Result<Command> | undefined {
  const rules = [
    profileFlagMessage(name, flags),
    profileRequirementMessage(name, flags),
    scaffoldFlagMessage(name, flags),
  ];
  const message = rules.find((rule) => rule !== undefined);
  return message === undefined ? undefined : invalidArguments(message.trim());
}

function profileFlagMessage(
  name: Command['name'],
  flags: { readonly profile?: string },
): string | undefined {
  return flags.profile !== undefined && name !== 'profile-lint'
    ? '--profile is only valid with profile lint.'
    : undefined;
}

function profileRequirementMessage(
  name: Command['name'],
  flags: { readonly profile?: string },
): string | undefined {
  return name === 'profile-lint' && flags.profile === undefined
    ? 'profile lint requires --profile build-spec@1.'
    : undefined;
}

function scaffoldFlagMessage(
  name: Command['name'],
  flags: { readonly preset?: Command['preset'] },
): string | undefined {
  const hasScaffoldFlags = flags.preset?.id !== undefined || flags.preset?.title !== undefined;
  return name !== 'profile-scaffold' && name !== 'recipe-admit' && hasScaffoldFlags
    ? '--id and --title are only valid with profile scaffold or recipe admit.'
    : undefined;
}

/** A malformed or misplaced argument; nothing was read or sent. */
function invalidArguments(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}
