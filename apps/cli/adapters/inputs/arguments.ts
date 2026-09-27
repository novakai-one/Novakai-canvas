/*
 * `pnpm canvas` argv → CommandArguments: Node parses the flags, then the placement rules check the
 * command word, the operand count and which commands accept --profile, --id, --title, --section
 * and --object. Pure apart from Node's argument parser; nothing is read or sent. Fails with
 * `invalid-command` or `invalid-arguments`: the caller corrects the named argument and runs the
 * command again. Core checks each value (`core/commands/values.ts`).
 */
import { parseArgs } from 'node:util';
import { commandName } from '../../contract/records/command.js';
import type { CommandName } from '../../contract/records/command.js';
import type { CommandArguments, CommandFlags } from '../../contract/records/arguments.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** A command word and its operand, before the flags are attached. */
interface CommandWords {
  readonly name: CommandName;
  readonly operand: string;
}

/** One parsed argv token; only option names are read. */
interface Token {
  readonly kind: string;
  readonly name?: string;
}

/**
 * Flags are parsed by Node; unknown flags, extra operands and misplaced flags fail before any
 * file or network I/O. Fails with `invalid-arguments` (an unknown or malformed flag, a wrong
 * operand count, a misplaced flag) or `invalid-command`.
 */
export function readArguments(
  args: readonly string[],
  defaultWorkspace: string,
): Result<CommandArguments> {
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
    const { help, server, workspace, ...flags } = parsed.values;
    const words = readCommand(commandOperands(help, parsed.positionals), flags, parsed.tokens);
    if (!words.ok) return words;
    return success({ ...words.value, flags, options: { server, workspace } });
  } catch {
    return failure({
      code: 'invalid-arguments',
      message: 'Unknown or malformed CLI flag',
      recovery:
        'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.',
    });
  }
}

/** The command word, then its operand count, then which flags it accepts. */
function readCommand(
  positionals: readonly string[],
  flags: CommandFlags,
  tokens: readonly Token[],
): Result<CommandWords> {
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
  name: CommandName,
  positionals: readonly string[],
  flags: CommandFlags,
): Result<CommandWords> {
  const count = ['help', 'describe', 'list'].includes(name) ? 1 : 2;
  if (positionals.length !== count)
    return invalidArguments(`${name} requires ${count - 1} operand(s)`);
  return placed({ name, operand: positionals[1] ?? '' }, flags);
}

/** --profile, --id and --title first, then the read scope flags. */
function placed(
  words: CommandWords,
  flags: CommandFlags,
): Result<CommandWords> {
  const invalid = profileFlagFailure(words.name, flags) ?? readScopeFailure(words.name, flags);
  if (invalid !== undefined) return invalid;
  return success(words);
}

/** At most one of --section and --object, and only with read. Core checks their IDs. */
function readScopeFailure(
  name: CommandName,
  flags: Pick<CommandFlags, 'section' | 'object'>,
): Result<never> | undefined {
  const selected = [flags.section, flags.object].filter((value) => value !== undefined);
  if (selected.length > 1)
    return invalidArguments('--section and --object are mutually exclusive for read.');
  return selected.length === 0 || name === 'read'
    ? undefined
    : invalidArguments('--section and --object are only valid with read.');
}

function duplicateScopeFlag(tokens: readonly Token[]): boolean {
  const names = tokens.flatMap((token) =>
    token.kind === 'option' && (token.name === 'section' || token.name === 'object')
      ? [token.name]
      : [],
  );
  return names.some((name) => names.indexOf(name) !== names.lastIndexOf(name));
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
  name: CommandName,
  flags: Pick<CommandFlags, 'profile' | 'id' | 'title'>,
): Result<never> | undefined {
  const rules = [profileFlagMessage(name, flags), scaffoldFlagMessage(name, flags)];
  const message = rules.find((rule) => rule !== undefined);
  return message === undefined ? undefined : invalidArguments(message.trim());
}

function profileFlagMessage(
  name: CommandName,
  flags: Pick<CommandFlags, 'profile'>,
): string | undefined {
  return flags.profile !== undefined && name !== 'profile-lint'
    ? '--profile is only valid with profile lint.'
    : undefined;
}

function scaffoldFlagMessage(
  name: CommandName,
  flags: Pick<CommandFlags, 'id' | 'title'>,
): string | undefined {
  const hasScaffoldFlags = flags.id !== undefined || flags.title !== undefined;
  return name !== 'profile-scaffold' && name !== 'recipe-admit' && hasScaffoldFlags
    ? '--id and --title are only valid with profile scaffold or recipe admit.'
    : undefined;
}

/** A malformed or misplaced argument; nothing was read or sent. */
function invalidArguments(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}
