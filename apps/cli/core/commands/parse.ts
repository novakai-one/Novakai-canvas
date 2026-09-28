/*
 * Why this file exists
 *
 * An agent uses the CLI by typing a line like this:
 *
 *   pnpm canvas read my-diagram --section intro
 *
 * Before the CLI can do anything, it has to work out what that line asks for: which command it is,
 * what it acts on, and which options came with it. This file does that. Node has already split the
 * line into words and flags (the argv). This file turns them into one `ParsedCommand` the rest of
 * the CLI can run. If something was typed wrong, it says what, so the agent can fix it and try
 * again.
 *
 * It only looks at the words. It never opens a file or talks to the service.
 *
 * How to read the steps below: every step answers with a `Result` (see `contract/errors.ts`).
 * `ok: true` means the step worked and `value` holds what it made. `ok: false` means it found a
 * mistake. Mistakes about the command's shape are made in `failures.ts`. A mistake about one typed
 * value is made by the check that finds it, in `values.ts` or `recipe-values.ts`.
 */
import type { ArgvReading, CanvasFlag, RawArguments } from '../../contract/records/arguments.js';
import type { FilePath } from '../../contract/brands.js';
import type { CommandName, ParsedCommand } from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { checkAcceptedFlags } from './accepted-flags.js';
import { assembleCommand } from './assembly.js';
import type { AcceptedCommand, IdentifiedCommand, WellFormedArguments } from './command-stages.js';
import { chooseCommandWords } from './command-words.js';
import {
  malformedFlagFailure,
  repeatedScopeFlagFailure,
  unknownCommandFailure,
} from './failures.js';
import { readTypedFlags } from './flags.js';
import { checkOperandCount } from './operand-count.js';
import { isCommandName } from './table.js';

/** The two flags that pick part of a collection to read. Each may be typed only once. */
type ScopeFlag = 'section' | 'object';

/**
 * Works out which command was typed, and checks it was typed correctly.
 *
 * `argv` is the typed line as Node read it: its words and flags, or `malformed` when Node couldn't
 * read a flag.
 *
 * It takes three steps. If a step finds a mistake, it stops there and returns that mistake.
 * 1. Find the command. In `read my-diagram`, the command is `read`.
 * 2. Check the words and flags fit that command. `read` needs one word after it (the collection
 *    to read) and doesn't use `--out`.
 * 3. Check each value, for example that `--revision` is a number, and fill in what was left out.
 *    If `--workspace` wasn't typed, the command uses `defaultWorkspace`.
 *
 * The mistakes it can find: a flag it can't read, `--section` or `--object` typed twice, an
 * unknown command, too many or too few words, a flag the command doesn't use, or a bad value.
 */
export function parseCommand(
  argv: ArgvReading<CanvasFlag>,
  defaultWorkspace: FilePath,
): Result<ParsedCommand> {
  const identified = identifyCommand(argv);
  if (!identified.ok) {
    return identified;
  }
  const accepted = checkWordsAndFlags(identified.value);
  if (!accepted.ok) {
    return accepted;
  }
  return assembleCommand(accepted.value, defaultWorkspace);
}

/**
 * Step 1: finds which command was typed.
 *
 * `--help` anywhere means the `help` command. Otherwise the first word is the command, and
 * `theme`, `recipe` and `profile` join the word after them: `recipe admit` is one command.
 *
 * Stops at a flag it can't read, at `--section` or `--object` typed twice, or at a first word
 * that isn't a command.
 */
function identifyCommand(argv: ArgvReading<CanvasFlag>): Result<IdentifiedCommand> {
  const wellFormed = requireWellFormedArguments(argv);
  if (!wellFormed.ok) {
    return wellFormed;
  }
  const words = chooseCommandWords(wellFormed.value);
  const name = requireKnownCommand(words.commandWord);
  if (!name.ok) {
    return name;
  }
  const flags = readTypedFlags(wellFormed.value.flagValues);
  return success({ name: name.value, operandWords: words.operandWords, flags });
}

/**
 * Step 2: checks the words and flags fit the command.
 *
 * First the number of words after the command (`checkOperandCount`), then that every flag is one
 * the command uses (`checkAcceptedFlags`). Stops at the first that doesn't fit.
 */
function checkWordsAndFlags(identified: IdentifiedCommand): Result<AcceptedCommand> {
  const commandWithRightCount = checkOperandCount(identified);
  if (!commandWithRightCount.ok) {
    return commandWithRightCount;
  }
  return checkAcceptedFlags(commandWithRightCount.value);
}

/**
 * The words and flags, once every flag could be read and neither `--section` nor `--object` was
 * typed twice. (Node would quietly keep only the last `--section`, so the agent could read a
 * different part than they meant. Other flags may repeat; the last one wins.)
 */
function requireWellFormedArguments(argv: ArgvReading<CanvasFlag>): Result<WellFormedArguments> {
  if (argv.kind === 'malformed') {
    return malformedFlagFailure();
  }
  if (hasRepeatedScopeFlag(argv.arguments)) {
    return repeatedScopeFlagFailure();
  }
  return success(wellFormedArguments(argv.arguments));
}

/** Whether `--section` or `--object` was typed more than once. */
function hasRepeatedScopeFlag(rawArguments: RawArguments<CanvasFlag>): boolean {
  return rawArguments.repeated.some(isScopeFlag);
}

/** The words and flag values, without the list of repeated flags (only step 1 needed it). */
function wellFormedArguments(rawArguments: RawArguments<CanvasFlag>): WellFormedArguments {
  return { words: rawArguments.positionals, flagValues: rawArguments.values };
}

/** Whether the flag is `--section` or `--object`. */
function isScopeFlag(flag: CanvasFlag): flag is ScopeFlag {
  return flag === 'section' || flag === 'object';
}

/** The command its word names, such as `read`. Refuses a word that isn't a command, or no word. */
function requireKnownCommand(commandWord: string | undefined): Result<CommandName> {
  if (!isCommandName(commandWord)) {
    return unknownCommandFailure();
  }
  return success(commandWord);
}
