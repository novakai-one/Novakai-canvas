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
  const joinedWords = joinTwoWordCommand(wellFormed.words);
  return splitCommandWord(joinedWords);
}

/** Whether `--help` (or `-h`) was typed. */
function asksForHelp(wellFormed: WellFormedArguments): boolean {
  return wellFormed.flagValues.get('help') === true;
}

/** Joins a leading `theme`, `recipe` or `profile` to the next word, as in `recipe-admit`. */
function joinTwoWordCommand(words: readonly string[]): readonly string[] {
  const [firstWord, secondWord, ...laterWords] = words;
  const startsTwoWordCommand = isCommandGroup(firstWord) && secondWord !== undefined;
  if (!startsTwoWordCommand) {
    return words;
  }
  const twoWordCommand = `${firstWord}-${secondWord}`;
  return [twoWordCommand, ...laterWords];
}

/** Splits the first word off as the command's word, and keeps the rest as its operand words. */
function splitCommandWord(words: readonly string[]): CommandWords {
  const [commandWord, ...operandWords] = words;
  return { commandWord, operandWords };
}
