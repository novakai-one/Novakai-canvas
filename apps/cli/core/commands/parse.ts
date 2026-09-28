/*
 * Reading a `pnpm canvas` command line into one checked `ParsedCommand`, in the base CLI's order.
 * Each check hands the next one the stage type it makes (`command-stages.ts`). Pure. Every failure
 * comes before anything is read or sent, so the caller corrects the named argument and runs the
 * command again.
 */
import type { RawArguments, CanvasFlag } from '../../contract/records/arguments.js';
import type { CommandName, ParsedCommand } from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { checkAcceptedFlags } from './accepted-flags.js';
import { assembleCommand } from './assembly.js';
import type {
  AcceptedCommand,
  CanvasCommandLine,
  IdentifiedCommand,
  WellFormedArguments,
} from './command-stages.js';
import { chooseCommandWords } from './command-words.js';
import {
  invalidArgumentsFailure,
  malformedFlagFailure,
  unknownCommandFailure,
} from './failures.js';
import { readGivenFlags } from './flags.js';
import type { WorkspaceText } from './flags.js';
import { countOperand } from './operand-count.js';
import { isCommandName } from './table.js';

/** The read scope flags: each may be given once, and never together. */
type ScopeFlag = 'section' | 'object';

/**
 * Reads the command a `pnpm canvas` command line names, with every value checked.
 *
 * Steps; the first failure stops parsing and is returned unchanged:
 * 1. Identify the command. --help drops every typed word and becomes the `help` command; otherwise
 *    the first word names the command, joined with the next for `theme`, `recipe` and `profile`.
 *    A flag Node refused, or --section or --object given twice, is `invalid-arguments`; a first
 *    word that names no command is `invalid-command`.
 * 2. Check the operand and flags: more or fewer words than the command takes, or a flag it does
 *    not accept (the rules in `accepted-flags.ts`), is `invalid-arguments`.
 * 3. Assemble the command: `assembleCommand` checks every value and names each failure.
 *
 * Nothing is read or sent: no file, credential or service. `defaultWorkspace` is used when
 * --workspace is absent.
 */
export function parseCommand(
  commandLine: CanvasCommandLine,
  defaultWorkspace: WorkspaceText,
): Result<ParsedCommand> {
  const identified = identifyCommand(commandLine);
  if (!identified.ok) {
    return identified;
  }
  const accepted = checkOperandAndFlags(identified.value);
  if (!accepted.ok) {
    return accepted;
  }
  return assembleCommand(accepted.value, defaultWorkspace);
}

/**
 * The command the words name, the words after it and the flags as given. --help makes it `help`
 * (`chooseCommandWords`). Fails with `invalid-arguments` for arguments that are not well formed,
 * then with `invalid-command`.
 */
function identifyCommand(commandLine: CanvasCommandLine): Result<IdentifiedCommand> {
  const wellFormed = requireWellFormedArguments(commandLine);
  if (!wellFormed.ok) {
    return wellFormed;
  }
  const words = chooseCommandWords(wellFormed.value);
  const name = requireCommandName(words.firstWord);
  if (!name.ok) {
    return name;
  }
  const flags = readGivenFlags(wellFormed.value.values);
  return success({ name: name.value, operandWords: words.operandWords, flags });
}

/**
 * Counts the operand, then checks every flag is one the command accepts. Fails with
 * `invalid-arguments`: first for a wrong number of words, then for the first broken flag rule.
 */
function checkOperandAndFlags(identified: IdentifiedCommand): Result<AcceptedCommand> {
  const counted = countOperand(identified);
  if (!counted.ok) {
    return counted;
  }
  return checkAcceptedFlags(counted.value);
}

/**
 * The words and flag values Node read, once they are well formed. Fails with `invalid-arguments`:
 * first for a flag Node refused, then for --section or --object given more than once.
 */
function requireWellFormedArguments(commandLine: CanvasCommandLine): Result<WellFormedArguments> {
  if (commandLine.kind === 'malformed') {
    return malformedFlagFailure();
  }
  return rejectRepeatedScopeFlags(commandLine.arguments);
}

/**
 * The words and flag values, once neither --section nor --object was given twice: Node would keep
 * only the last value. Other repeated flags are allowed, so `repeated` is not passed on. Fails with
 * `invalid-arguments`; the base CLI's wording does not name the flag.
 */
function rejectRepeatedScopeFlags(
  rawArguments: RawArguments<CanvasFlag>,
): Result<WellFormedArguments> {
  const scopeFlagRepeated = rawArguments.repeated.some(isScopeFlag);
  if (scopeFlagRepeated) {
    return invalidArgumentsFailure('Each read scope flag may be provided only once.');
  }
  return success({ positionals: rawArguments.positionals, values: rawArguments.values });
}

/** Whether the flag is --section or --object. */
function isScopeFlag(flag: CanvasFlag): flag is ScopeFlag {
  return flag === 'section' || flag === 'object';
}

/**
 * The command the first word names. Fails with `invalid-command` when there is no word, or the
 * word names no command.
 */
function requireCommandName(firstWord: string | undefined): Result<CommandName> {
  if (!isCommandName(firstWord)) {
    return unknownCommandFailure();
  }
  return success(firstWord);
}
