/*
 * Why this file exists
 *
 * The first word an agent types usually names the command: `pnpm canvas list`. Two things make it
 * less simple:
 *
 *   - `theme`, `recipe` and `profile` start two-word commands. `recipe admit er.canvas` is the
 *     command `recipe-admit`, with `er.canvas` typed after it.
 *   - `--help` (or `-h`) anywhere means the `help` command, whatever words were typed.
 *
 * This file picks out the command's word, and the words typed after it. It never checks that the
 * word is a real command: `parse.ts` does that next.
 */
import type { WellFormedArguments } from './command-stages.js';
import { isCommandGroup } from './table.js';

/** The command's word and the words typed after it. Nothing is checked yet. */
export interface CommandWords {
  /**
   * The word that names the command, if it is one: `list`, `recipe-admit` for `recipe admit`, or
   * `help` for `--help`. Missing if no word was typed.
   */
  readonly commandWord: string | undefined;
  /** The words after the command: `['er.canvas']`. */
  readonly operandWords: readonly string[];
}

/** The words --help stands for: `help` alone. */
const helpCommandWords: CommandWords = Object.freeze({
  commandWord: 'help',
  operandWords: Object.freeze([]),
});

/**
 * Picks out the command's word, and the words typed after it.
 *
 * `--help` wins: the command is `help`, and every typed word is dropped. The flags are still
 * checked later, so `list --help --out x` prints the help, but `--help --profile x` is a mistake,
 * because `--profile` only goes with `profile lint`. Otherwise the words are kept in order, and
 * `theme`, `recipe` or `profile` joins the word after it: `recipe admit` becomes `recipe-admit`.
 */
export function chooseCommandWords(wellFormed: WellFormedArguments): CommandWords {
  if (asksForHelp(wellFormed)) {
    return helpCommandWords;
  }
  const typedWords = joinTwoWordCommand(wellFormed.words);
  return splitCommandWord(typedWords);
}

/** Whether --help (or -h) was given. */
function asksForHelp(wellFormed: WellFormedArguments): boolean {
  return wellFormed.flagValues.get('help') === true;
}

/**
 * `recipe admit FILE` becomes `recipe-admit FILE`: a leading `theme`, `recipe` or `profile` joins
 * the word after it. Other words, and any of those three typed alone, are returned as given.
 */
function joinTwoWordCommand(words: readonly string[]): readonly string[] {
  const [first, second, ...rest] = words;
  const joinsNextWord = isCommandGroup(first) && second !== undefined;
  if (!joinsNextWord) {
    return words;
  }
  const twoWordCommand = `${first}-${second}`;
  return [twoWordCommand, ...rest];
}

/** The first word as the command's word, and the words after it. With no words, it is missing. */
function splitCommandWord(words: readonly string[]): CommandWords {
  const [commandWord, ...operandWords] = words;
  return { commandWord, operandWords };
}
