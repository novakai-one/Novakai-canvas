/*
 * Why this file exists
 *
 * The first word usually names the command, but not always. `recipe admit er.canvas` is the
 * command `recipe-admit`, and `--help` anywhere means the `help` command.
 *
 * This file picks the command's word and the words typed after it. It never checks that the word
 * is a real command: `parse.ts` does that next.
 */
import type { WellFormedArguments } from './command-stages.js';
import { isCommandGroup } from './table.js';

/** The command's word and the words typed after it. Nothing is checked yet. */
export interface CommandWords {
  /**
   * The first word, or the joined two-word command: `list`, or `recipe-admit` for `recipe admit`.
   * It is `help` when `--help` was typed. Missing if no word was typed. Not checked yet.
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
 * Picks the command's word, and the words typed after it.
 *
 * `recipe admit er.canvas` gives `recipe-admit` and `['er.canvas']`. With `--help`, the command is
 * `help` and every typed word is dropped.
 */
export function pickCommandWords(wellFormed: WellFormedArguments): CommandWords {
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
