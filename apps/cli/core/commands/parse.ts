/*
 * Reading a `pnpm canvas` command line into one checked `ParsedCommand`, in the base CLI's order:
 * the arguments are well formed; the first word names a command; the command has exactly the
 * operand it takes; its flags pass the placement rules (`placement.ts`); every value is checked
 * (`operands.ts`). Pure. Every failure comes before anything is read or sent, so the caller
 * corrects the named argument and runs the command again.
 */
import type { ArgvReading, CanvasFlag, RawArguments } from '../../contract/records/arguments.js';
import type { CommandName, ParsedCommand } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { invalidArguments } from './failures.js';
import { collectCommandFlags } from './flags.js';
import type { CommandFlags } from './flags.js';
import { assembleCommand } from './operands.js';
import { checkFlagPlacement } from './placement.js';
import type { CountedCommand, PlacedCommand } from './placed-command.js';
import { isCommandName, isFamilyWord, takesNoOperand } from './table.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/** The read scope flags: each may be given once, and never together. */
type ScopeFlag = 'section' | 'object';

/** How many words a command takes after its name. */
type OperandCount = 0 | 1;

/** What to type instead, after a flag Node refused. */
const malformedFlagRecovery =
  'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.';

/** The words `--help` stands for: the `help` command alone. */
const helpCommandWords: readonly string[] = Object.freeze(['help']);

/** The words and flag values Node read, with no flag refused and no scope flag repeated. */
interface WellFormedArguments {
  readonly positionals: readonly string[];
  readonly values: ReadonlyMap<CanvasFlag, string | boolean>;
}

/** A known command, the words typed after it, and the text of each flag. */
interface IdentifiedCommand {
  readonly name: CommandName;
  readonly operands: readonly string[];
  readonly flags: CommandFlags;
}

/**
 * Reads the command a `pnpm canvas` command line names, with every value checked.
 *
 * Steps; the first failure stops parsing and is returned unchanged:
 * 1. Identify the command: a flag Node refused, or --section or --object given twice, is
 *    `invalid-arguments`; a first word that names no command is `invalid-command`.
 * 2. Check the operand and flags: more or fewer words than the command takes, a flag it does not
 *    accept, --section with --object, or `profile lint` without --profile is `invalid-arguments`.
 * 3. Assemble the command: `assembleCommand` checks every value and names each failure.
 *
 * Nothing is read or sent: no file, credential or service. `defaultWorkspace` is the --workspace
 * text used when the flag is absent.
 */
export function parseCommand(
  commandLine: ArgvReading<CanvasFlag>,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  const identified = identifyCommand(commandLine);
  if (!identified.ok) {
    return identified;
  }
  const placed = checkOperandAndFlags(identified.value);
  if (!placed.ok) {
    return placed;
  }
  return assembleCommand(placed.value, defaultWorkspace);
}

/**
 * The command the first word names, the words after it and the text of each flag, once the
 * arguments are well formed. Fails with `invalid-arguments` for malformed arguments, then with
 * `invalid-command` when there is no word or the first word names no command.
 */
function identifyCommand(commandLine: ArgvReading<CanvasFlag>): Result<IdentifiedCommand> {
  const wellFormed = rejectMalformedArguments(commandLine);
  if (!wellFormed.ok) {
    return wellFormed;
  }
  const [word, ...operands] = commandWords(wellFormed.value);
  if (!isKnownCommand(word)) {
    return unknownCommand();
  }
  const flags = collectCommandFlags(wellFormed.value.values);
  return success({ name: word, operands, flags });
}

/**
 * The words and flag values Node read, once they are well formed. Fails with `invalid-arguments`:
 * first for a flag Node refused, then for --section or --object given more than once.
 */
function rejectMalformedArguments(
  commandLine: ArgvReading<CanvasFlag>,
): Result<WellFormedArguments> {
  if (commandLine.kind === 'malformed') {
    return malformedFlag();
  }
  return rejectRepeatedScopeFlags(commandLine.arguments);
}

/** Node refused a flag: an unknown flag, a text flag with no value, or a value on a switch. */
function malformedFlag(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Unknown or malformed CLI flag',
    recovery: malformedFlagRecovery,
  });
}

/**
 * The words and flag values, when --section and --object are each given at most once: Node would
 * keep only the last value. Fails with `invalid-arguments`.
 */
function rejectRepeatedScopeFlags(given: RawArguments<CanvasFlag>): Result<WellFormedArguments> {
  const scopeFlagRepeated = given.repeated.some(isScopeFlag);
  if (scopeFlagRepeated) {
    return invalidArguments('Each read scope flag may be provided only once.');
  }
  return success({ positionals: given.positionals, values: given.values });
}

/** Whether the flag is --section or --object. */
function isScopeFlag(flag: CanvasFlag): flag is ScopeFlag {
  return flag === 'section' || flag === 'object';
}

/**
 * The words that name the command and its operand. `--help` anywhere asks for the `help` command,
 * so every typed word is dropped; otherwise a family word joins the word after it.
 */
function commandWords(wellFormed: WellFormedArguments): readonly string[] {
  if (asksForHelp(wellFormed)) {
    return helpCommandWords;
  }
  return joinFamilyWord(wellFormed.positionals);
}

/** Whether --help (or -h) was given. */
function asksForHelp(wellFormed: WellFormedArguments): boolean {
  return wellFormed.values.get('help') === true;
}

/**
 * `recipe admit FILE` becomes `recipe-admit FILE`: a leading family word (`theme`, `recipe`,
 * `profile`) joins the word after it. Other words, and a family word typed alone, are returned
 * as given.
 */
function joinFamilyWord(words: readonly string[]): readonly string[] {
  const [family, member, ...rest] = words;
  if (family === undefined || member === undefined || !isFamilyWord(family)) {
    return words;
  }
  return [`${family}-${member}`, ...rest];
}

/** Whether the word names a command; no word at all names none. */
function isKnownCommand(word: string | undefined): word is CommandName {
  return word !== undefined && isCommandName(word);
}

/** No command has this name. */
function unknownCommand(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-command',
    message: 'Choose a supported canvas or profile command',
  });
}

/**
 * The identified command with exactly the operand it takes and only the flags it accepts. Fails
 * with `invalid-arguments`: first for a wrong operand count, then for the first broken placement
 * rule (`placement.ts`).
 */
function checkOperandAndFlags(identified: IdentifiedCommand): Result<PlacedCommand> {
  const counted = checkOperandCount(identified);
  if (!counted.ok) {
    return counted;
  }
  return checkFlagPlacement(counted.value, identified.flags);
}

/**
 * The command with exactly the operand it takes: none for `help`, `describe` and `list`, one word
 * for every other command. Fails with `invalid-arguments` for any other number of words.
 */
function checkOperandCount(identified: IdentifiedCommand): Result<CountedCommand> {
  const { name, operands } = identified;
  if (takesNoOperand(name)) {
    return requireNoOperand(name, operands);
  }
  return requireOneOperand(name, operands);
}

/** The command alone, when no word follows it. Fails with `invalid-arguments`. */
function requireNoOperand(
  name: NoOperandCommand,
  operands: readonly string[],
): Result<CountedCommand> {
  if (operands.length > 0) {
    return wrongOperandCount(name, 0);
  }
  return success({ name });
}

/** The command and its one operand. Fails with `invalid-arguments` for no word, or two or more. */
function requireOneOperand(
  name: OneOperandCommand,
  operands: readonly string[],
): Result<CountedCommand> {
  const [operand, ...extra] = operands;
  if (operand === undefined || extra.length > 0) {
    return wrongOperandCount(name, 1);
  }
  return success({ name, operand });
}

/** The command was given more or fewer words than it takes. */
function wrongOperandCount(
  name: CommandName,
  expected: OperandCount,
): Result<never, LocalFailure> {
  return invalidArguments(`${name} requires ${expected} operand(s)`);
}
