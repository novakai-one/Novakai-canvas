/*
 * Reading a `pnpm canvas` command line into one checked `ParsedCommand`, in the base CLI's order:
 * Node read every flag; no read scope flag is repeated; the command is known; it has its operand
 * count; every flag is placed where it is read (`placement.ts`); every value is checked
 * (`operands.ts`). Pure. Every failure comes before anything is read or sent, so the caller
 * corrects the named argument and runs the command again.
 */
import type { ArgvReading, CanvasFlag, RawArguments } from '../../contract/records/arguments.js';
import type { CommandName, ParsedCommand } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { readTextFlags } from './flags.js';
import type { CommandDefaults } from './flags.js';
import { assembleCommand } from './operands.js';
import { checkPlacement } from './placement.js';
import type { GivenFlags } from './placement.js';
import { commandRow, isCommandName, isFamilyWord } from './table.js';
import type { CommandRow } from './table.js';
import type { CommandWords } from './words.js';

/** What to type instead, after a flag Node refused. */
const commonUsage =
  'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.';

/** The words `--help` stands for: the `help` command, with every other word dropped. */
const helpWords: readonly string[] = Object.freeze(['help']);

/** The operand of a command that takes none; that command's checks never read it. */
const noOperand = '';

/** A known command, the words after it, and the flags it was given, as text. */
interface NamedCommand extends GivenFlags {
  readonly operands: readonly string[];
}

/**
 * Reads the command a `pnpm canvas` command line names, with every value checked.
 *
 * Steps; the first failure stops parsing and is returned unchanged:
 * 1. Accept the arguments: a flag Node refused, or a repeated --section or --object, is
 *    `invalid-arguments`.
 * 2. Read the command words: an unknown command is `invalid-command`; a wrong operand count or a
 *    flag the command does not read is `invalid-arguments`.
 * 3. Assemble the command: `assembleCommand` checks every value and names each failure.
 *
 * Nothing is read or sent: no file, credential or service.
 */
export function parseCommand(
  commandLine: ArgvReading<CanvasFlag>,
  defaults: CommandDefaults,
): Result<ParsedCommand> {
  const accepted = acceptArguments(commandLine);
  if (!accepted.ok) return accepted;
  const words = readCommandWords(accepted.value);
  if (!words.ok) return words;
  return assembleCommand(words.value, defaults);
}

/**
 * The arguments Node read, when it read them faithfully. Fails with `invalid-arguments`: a flag
 * Node refused, then --section or --object given more than once.
 */
function acceptArguments(commandLine: ArgvReading<CanvasFlag>): Result<RawArguments<CanvasFlag>> {
  if (commandLine.kind === 'malformed') return malformedFlag();
  return requireScopeOnce(commandLine.arguments);
}

/**
 * The arguments, when --section and --object are each given at most once: Node would keep only
 * the last value. Fails with `invalid-arguments`.
 */
function requireScopeOnce(accepted: RawArguments<CanvasFlag>): Result<RawArguments<CanvasFlag>> {
  const scopeRepeated = accepted.repeated.some(isScopeFlag);
  if (scopeRepeated) return invalidArguments('Each read scope flag may be provided only once.');
  return success(accepted);
}

/**
 * The command words, checked in order. Fails with `invalid-command` (no such command), then
 * `invalid-arguments` (a wrong operand count or a flag the command does not read).
 */
function readCommandWords(accepted: RawArguments<CanvasFlag>): Result<CommandWords> {
  const named = nameCommand(accepted);
  if (!named.ok) return named;
  return checkArguments(named.value);
}

/**
 * The command the first word names, the words after it and the flag text. Fails with
 * `invalid-command`, also when there is no word at all.
 */
function nameCommand(accepted: RawArguments<CanvasFlag>): Result<NamedCommand> {
  const [word, ...operands] = readSpokenWords(accepted);
  if (!isKnownCommand(word)) return unknownCommand();
  const flags = readTextFlags(accepted.values);
  return success({ name: word, operands, flags });
}

/**
 * Exactly the operands the command takes, then every flag where the command reads it. Neither an
 * operand nor a flag is silently ignored. Fails with `invalid-arguments`.
 */
function checkArguments(named: NamedCommand): Result<CommandWords> {
  const operand = takeOperand(named);
  if (!operand.ok) return operand;
  const placement = checkPlacement(named);
  if (!placement.ok) return placement;
  return success({ name: named.name, operand: operand.value, flags: named.flags });
}

/**
 * The command's one operand, or `noOperand` for a command that takes none. Any other number of
 * words than the command table's count fails with `invalid-arguments`.
 */
function takeOperand(named: NamedCommand): Result<string> {
  const expected = commandRow(named.name).operands;
  if (named.operands.length !== expected) return wrongOperandCount(named.name, expected);
  const [operand = noOperand] = named.operands;
  return success(operand);
}

/**
 * The words as the user spoke them. `--help` stands for the `help` command and drops every word;
 * otherwise a family word joins the word after it.
 */
function readSpokenWords(accepted: RawArguments<CanvasFlag>): readonly string[] {
  const helpAsked = accepted.values.get('help') === true;
  if (helpAsked) return helpWords;
  return joinFamilyWord(accepted.positionals);
}

/**
 * `recipe admit FILE` becomes `recipe-admit FILE`: a leading family word (`theme`, `recipe`,
 * `profile`) joins the word after it. Other words are returned as given. A family word alone
 * becomes `recipe-`, which names no command.
 */
function joinFamilyWord(words: readonly string[]): readonly string[] {
  const [family = '', member = '', ...rest] = words;
  if (!isFamilyWord(family)) return words;
  return [`${family}-${member}`, ...rest];
}

/** Whether the word names a command; no word at all names none. */
function isKnownCommand(word: string | undefined): word is CommandName {
  return word !== undefined && isCommandName(word);
}

/** Whether the flag is --section or --object. */
function isScopeFlag(flag: CanvasFlag): boolean {
  return flag === 'section' || flag === 'object';
}

/** Node refused a flag: an unknown flag, a text flag with no value, or a value on a switch. */
function malformedFlag(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Unknown or malformed CLI flag',
    recovery: commonUsage,
  });
}

/** No command has this name. */
function unknownCommand(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-command',
    message: 'Choose a supported canvas or profile command',
  });
}

/** The command was given more or fewer words than it takes. */
function wrongOperandCount(
  name: CommandName,
  expected: CommandRow['operands'],
): Result<never, LocalFailure> {
  return invalidArguments(`${name} requires ${expected} operand(s)`);
}

/** A malformed or misplaced argument; nothing was read or sent. */
function invalidArguments(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}
