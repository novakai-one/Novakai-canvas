/*
 * Which typed words name the command, as the base CLI chose them: --help replaces them with
 * `help`, and a family word (`theme`, `recipe`, `profile`) joins the word after it. No word is
 * checked here; `parse.ts` checks the first one names a command. Pure.
 */
import type { WellFormedArguments } from './command-stages.js';
import { isFamilyWord } from './table.js';

/** The first word, which should name a command, and the words typed after it. */
export interface CommandWords {
  readonly firstWord: string | undefined;
  readonly operandWords: readonly string[];
}

/** The words --help stands for: `help` alone. */
const helpCommandWords: CommandWords = Object.freeze({
  firstWord: 'help',
  operandWords: Object.freeze([]),
});

/**
 * The words that name the command. --help wins: every typed word is dropped and the command is
 * `help`. Its flags are still checked, so `list --help --out x` prints usage while
 * `--help --profile x` fails. Otherwise the typed words, with a family word joined to the next.
 */
export function chooseCommandWords(wellFormed: WellFormedArguments): CommandWords {
  if (asksForHelp(wellFormed)) {
    return helpCommandWords;
  }
  const typedWords = joinFamilyWord(wellFormed.positionals);
  return splitFirstWord(typedWords);
}

/** Whether --help (or -h) was given. */
function asksForHelp(wellFormed: WellFormedArguments): boolean {
  return wellFormed.values.get('help') === true;
}

/**
 * `recipe admit FILE` becomes `recipe-admit FILE`: a leading family word joins the word after it.
 * Other words, and a family word typed alone, are returned as given.
 */
function joinFamilyWord(words: readonly string[]): readonly string[] {
  const [first, second, ...rest] = words;
  const joinsNextWord = isFamilyWord(first) && second !== undefined;
  if (!joinsNextWord) {
    return words;
  }
  const familyCommand = `${first}-${second}`;
  return [familyCommand, ...rest];
}

/** The first word and the words after it. With no words, the first word is `undefined`. */
function splitFirstWord(words: readonly string[]): CommandWords {
  const [firstWord, ...operandWords] = words;
  return { firstWord, operandWords };
}
