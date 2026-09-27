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
import { lintProfileRequired } from '../../contract/records/arguments.js';
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

/** A word that joins the next word into one command name: `recipe admit` → `recipe-admit`. */
type Family = 'theme' | 'recipe' | 'profile';

/** How many operands a command takes after its name. */
type OperandCount = 0 | 1;

/** A placement rule: the message when the command may not take a flag it was given, else undefined. */
type PlacementRule = (name: CommandName, flags: CommandFlags) => string | undefined;

/** How Node parses one value flag core reads. */
interface FlagOption {
  readonly type: 'string';
  readonly default?: string;
}

/** The value flags core reads, one per `CommandFlags` key: a missing or extra flag is a type error. */
const commandFlags = Object.freeze({
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
} as const satisfies Readonly<Record<keyof CommandFlags, FlagOption>>);

/** Every family word, keyed by itself. */
const families: Readonly<Record<Family, Family>> = Object.freeze({
  theme: 'theme',
  recipe: 'recipe',
  profile: 'profile',
});

/** The profile and scaffold placement rules, in the base CLI's order; the first broken rule is reported. */
const profileRules: readonly PlacementRule[] = Object.freeze([
  profileOnlyWithLint,
  lintNeedsProfile,
  scaffoldFlags,
]);

/** Every command's operand count: a missing or misspelt command is a type error. */
const operandCounts: Readonly<Record<CommandName, OperandCount>> = Object.freeze({
  help: 0,
  describe: 0,
  list: 0,
  read: 1,
  inspect: 1,
  create: 1,
  replace: 1,
  patch: 1,
  preview: 1,
  receipt: 1,
  retry: 1,
  apply: 1,
  'theme-admit': 1,
  'recipe-admit': 1,
  'recipe-instantiate': 1,
  'profile-describe': 1,
  'profile-scaffold': 1,
  'profile-lint': 1,
});

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
        ...commandFlags,
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

/** A repeated read scope flag, then the command word, then its operands and flags. */
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
  const count = operandCounts[name];
  if (positionals.length !== count + 1)
    return invalidArguments(`${name} requires ${count} operand(s)`);
  return placed({ name, operand: positionals[1] ?? '' }, flags);
}

/** The profile and scaffold rules first, then the read scope flags. */
function placed(
  words: CommandWords,
  flags: CommandFlags,
): Result<CommandWords> {
  const invalid = profileFlagFailure(words.name, flags) ?? readScopeFailure(words.name, flags);
  if (invalid !== undefined) return invalid;
  return success(words);
}

/** The first profile or scaffold placement rule the command breaks; `invalid-arguments`. */
function profileFlagFailure(
  name: CommandName,
  flags: CommandFlags,
): Result<never> | undefined {
  const message = profileRules.map((rule) => rule(name, flags)).find((text) => text !== undefined);
  if (message === undefined) return undefined;
  return invalidArguments(message);
}

/** --profile names the profile `profile lint` checks against; no other command takes it. */
function profileOnlyWithLint(
  name: CommandName,
  flags: Pick<CommandFlags, 'profile'>,
): string | undefined {
  if (flags.profile === undefined || name === 'profile-lint') return undefined;
  return '--profile is only valid with profile lint.';
}

/** `profile lint` needs --profile. Checked before the read scope flags, as the base CLI does. */
function lintNeedsProfile(
  name: CommandName,
  flags: Pick<CommandFlags, 'profile'>,
): string | undefined {
  if (name !== 'profile-lint' || flags.profile !== undefined) return undefined;
  return lintProfileRequired;
}

/** --id and --title name what `profile scaffold` or `recipe admit` creates; no other command takes them. */
function scaffoldFlags(
  name: CommandName,
  flags: Pick<CommandFlags, 'id' | 'title'>,
): string | undefined {
  if (takesScaffoldFlags(name) || !hasScaffoldFlags(flags)) return undefined;
  return '--id and --title are only valid with profile scaffold or recipe admit.';
}

/** Whether the command names what it creates with --id and --title. */
function takesScaffoldFlags(name: CommandName): boolean {
  return name === 'profile-scaffold' || name === 'recipe-admit';
}

/** Whether --id or --title is given. */
function hasScaffoldFlags(flags: Pick<CommandFlags, 'id' | 'title'>): boolean {
  return flags.id !== undefined || flags.title !== undefined;
}

/** At most one of --section and --object, and only with read. Core checks their IDs. */
function readScopeFailure(
  name: CommandName,
  flags: Pick<CommandFlags, 'section' | 'object'>,
): Result<never> | undefined {
  const selected = [flags.section, flags.object].filter((value) => value !== undefined);
  if (selected.length > 1)
    return invalidArguments('--section and --object are mutually exclusive for read.');
  if (selected.length === 0 || name === 'read') return undefined;
  return invalidArguments('--section and --object are only valid with read.');
}

/** Whether --section or --object is given twice; Node would silently keep only the last value. */
function duplicateScopeFlag(tokens: readonly Token[]): boolean {
  const names = tokens.filter(isScopeFlag).map((token) => token.name);
  return names.some((name, index) => names.indexOf(name) !== index);
}

/** Whether the token is a --section or --object option. */
function isScopeFlag(token: Token): boolean {
  return token.kind === 'option' && (token.name === 'section' || token.name === 'object');
}

/** Help is a local command and never needs a running workspace; a family word joins the next word. */
function commandOperands(
  help: boolean | undefined,
  positionals: readonly string[],
): readonly string[] {
  if (help) return ['help'];
  const [first = '', second = '', ...rest] = positionals;
  if (!isFamily(first)) return positionals;
  return [`${first}-${second}`, ...rest];
}

/** Whether `word` is a family word; inherited object keys such as `constructor` are not. */
function isFamily(word: string): word is Family {
  return Object.hasOwn(families, word);
}

/** A malformed or misplaced argument; nothing was read or sent. */
function invalidArguments(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}
