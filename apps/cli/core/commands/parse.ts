/*
 * Reading a `pnpm canvas` command line into one checked `ParsedCommand`, in the base CLI's order:
 * the arguments are well formed; the first word names a command; the command has exactly the
 * operand it takes and only the flags it accepts (`placement.ts`); every value is checked
 * (`assembly.ts`). Pure. Every failure comes before anything is read or sent, so the caller
 * corrects the named argument and runs the command again.
 */
import type { ArgvReading, CanvasFlag, RawArguments } from '../../contract/records/arguments.js';
import type { CommandName, ParsedCommand } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { assembleCommand } from './assembly.js';
import { invalidArguments, invalidCommand, malformedFlagFailure } from './failures.js';
import { readTextFlags } from './flags.js';
import type { CommandFlags } from './flags.js';
import { checkFlagPlacement } from './placement.js';
import type { PlacedCommand } from './placed-command.js';
import { isCommandName, isFamilyWord, takesNoOperand } from './table.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/** The read scope flags: each may be given once, and never together. */
type ScopeFlag = 'section' | 'object';

/** How many words a command takes after its name. */
type OperandCount = 0 | 1;

/** The words and flag values Node read, with no flag refused and no scope flag repeated. */
interface WellFormedArguments {
  readonly positionals: readonly string[];
  readonly values: ReadonlyMap<CanvasFlag, string | boolean>;
}

/** The first word, which should name a command, and the words typed after it. */
interface CommandWords {
  readonly name: string | undefined;
  readonly operandWords: readonly string[];
}

/** A known command, the words typed after it (not yet counted), and the text of each flag. */
interface IdentifiedCommand {
  readonly name: CommandName;
  readonly operandWords: readonly string[];
  readonly flags: CommandFlags;
}

/**
 * What `--help` stands for: the `help` command alone, with every typed word dropped. The flags
 * are kept, and `help` accepts all but five of them (`besideHelp` in `table.ts`): `list --help
 * --out x` still prints usage, while `--help --profile x` still fails placement.
 */
const helpWords: CommandWords = Object.freeze({ name: 'help', operandWords: Object.freeze([]) });

/**
 * Reads the command a `pnpm canvas` command line names, with every value checked.
 *
 * Steps; the first failure stops parsing and is returned unchanged:
 * 1. Identify the command: a flag Node refused, or --section or --object given twice, is
 *    `invalid-arguments`; a first word that names no command is `invalid-command`.
 * 2. Place the command: more or fewer words than the command takes, a flag it does not accept,
 *    --section with --object, or `profile lint` without --profile is `invalid-arguments`.
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
  const placed = placeCommand(identified.value);
  if (!placed.ok) {
    return placed;
  }
  return assembleCommand(placed.value, defaultWorkspace);
}

/**
 * Identifies the command: the arguments must be well formed, then the first word must name a
 * command. Fails with `invalid-arguments`, then with `invalid-command`.
 */
function identifyCommand(commandLine: ArgvReading<CanvasFlag>): Result<IdentifiedCommand> {
  const wellFormed = readWellFormedArguments(commandLine);
  if (!wellFormed.ok) {
    return wellFormed;
  }
  return lookUpCommand(wellFormed.value);
}

/**
 * Places the command's words and flags: exactly the operand it takes, then only the flags it
 * accepts. Fails with `invalid-arguments`: first for a wrong number of words, then for the first
 * broken placement rule (`placement.ts`).
 */
function placeCommand(identified: IdentifiedCommand): Result<PlacedCommand> {
  const counted = checkOperandCount(identified);
  if (!counted.ok) {
    return counted;
  }
  return checkFlagPlacement(counted.value);
}

/**
 * The words and flag values Node read, once they are well formed. Fails with `invalid-arguments`:
 * first for a flag Node refused, then for --section or --object given more than once.
 */
function readWellFormedArguments(
  commandLine: ArgvReading<CanvasFlag>,
): Result<WellFormedArguments> {
  if (commandLine.kind === 'malformed') {
    return malformedFlagFailure();
  }
  return requireSingleScopeFlags(commandLine.arguments);
}

/**
 * The words and flag values, when --section and --object are each given at most once: Node would
 * keep only the last value. Fails with `invalid-arguments`.
 */
function requireSingleScopeFlags(
  rawArguments: RawArguments<CanvasFlag>,
): Result<WellFormedArguments> {
  const scopeFlagRepeated = rawArguments.repeated.some(isScopeFlag);
  if (scopeFlagRepeated) {
    return invalidArguments('Each read scope flag may be provided only once.');
  }
  return success({ positionals: rawArguments.positionals, values: rawArguments.values });
}

/** Whether the flag is --section or --object. */
function isScopeFlag(flag: CanvasFlag): flag is ScopeFlag {
  return flag === 'section' || flag === 'object';
}

/**
 * The command the first word names, the words after it and the text of each flag. Fails with
 * `invalid-command` when there is no word or the first word names no command.
 */
function lookUpCommand(wellFormed: WellFormedArguments): Result<IdentifiedCommand> {
  const { name, operandWords } = readCommandWords(wellFormed);
  if (!isCommandName(name)) {
    return invalidCommand();
  }
  const flags = readTextFlags(wellFormed.values);
  return success({ name, operandWords, flags });
}

/**
 * The first word and the words after it: the help words when --help was given; otherwise the
 * typed words, with a family word joined to the word after it.
 */
function readCommandWords(wellFormed: WellFormedArguments): CommandWords {
  if (asksForHelp(wellFormed)) {
    return helpWords;
  }
  const [name, ...operandWords] = joinFamilyWord(wellFormed.positionals);
  return { name, operandWords };
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
  if (member === undefined || !isFamilyWord(family)) {
    return words;
  }
  const familyCommand = `${family}-${member}`;
  return [familyCommand, ...rest];
}

/**
 * The command with exactly the operand it takes: none for `help`, `describe` and `list`, one word
 * for every other command. Fails with `invalid-arguments` for any other number of words.
 */
function checkOperandCount(identified: IdentifiedCommand): Result<PlacedCommand> {
  const { name, operandWords, flags } = identified;
  if (takesNoOperand(name)) {
    return requireNoOperand(name, operandWords, flags);
  }
  return requireOneOperand(name, operandWords, flags);
}

/** The command and its flags, when no word follows it. Fails with `invalid-arguments`. */
function requireNoOperand(
  name: NoOperandCommand,
  operandWords: readonly string[],
  flags: CommandFlags,
): Result<PlacedCommand> {
  if (operandWords.length > 0) {
    return wrongOperandCount(name, 0);
  }
  return success({ name, flags });
}

/**
 * The command, its one operand and its flags. Fails with `invalid-arguments` for no word, or two
 * or more.
 */
function requireOneOperand(
  name: OneOperandCommand,
  operandWords: readonly string[],
  flags: CommandFlags,
): Result<PlacedCommand> {
  const [operand, ...extraWords] = operandWords;
  if (operand === undefined || extraWords.length > 0) {
    return wrongOperandCount(name, 1);
  }
  return success({ name, operand, flags });
}

/**
 * The command was given more or fewer words than it takes. The base CLI's wording is kept: it
 * names the joined command, such as `recipe-admit requires 1 operand(s)`.
 */
function wrongOperandCount(
  name: CommandName,
  expected: OperandCount,
): Result<never, LocalFailure> {
  return invalidArguments(`${name} requires ${expected} operand(s)`);
}
