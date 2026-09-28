/*
 * Why this file exists
 *
 * When an agent types `--section intro`, Node's `parseArgs` reads `intro` as the value of
 * `--section`. The CLI keeps `intro` exactly as typed. Nothing is checked yet, so every value here
 * is plain text, and the types say so. Checking comes later, in `values.ts`: that is where
 * `--revision 3` becomes a checked revision number and `--workspace` becomes a checked folder path.
 *
 * This file only sorts what Node read into two things the next steps need: the text typed after
 * each flag, and the order the flags were typed in.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';

/** A flag typed with text after it, such as `--revision 3`. That's every flag except `--help`. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/**
 * The text typed after each flag, exactly as typed: `{ revision: '3' }` for `--revision 3`. A flag
 * that wasn't typed is left out.
 */
export type TypedFlagText = Readonly<Partial<Record<TextFlag, string>>>;

/** The typed flags: the text after each one, and the order they were typed in. */
export interface TypedFlags {
  readonly text: TypedFlagText;
  /** Kept only so a mistake can name the first flag the command doesn't take. */
  readonly typedOrder: readonly TextFlag[];
}

/** What Node's `parseArgs` read for one flag: the typed text, or `true` for `--help`. */
export type FlagValue = string | boolean;

/** One flag and the text typed after it. */
type TextEntry = [TextFlag, string];

/**
 * Sorts what Node read for each flag into the text typed after it and the order the flags were
 * typed in. Leaves out `--help`, which has no text.
 */
export function readTypedFlags(flagValues: ReadonlyMap<CanvasFlag, FlagValue>): TypedFlags {
  const textEntries = [...flagValues].filter(isTextEntry);
  const text: TypedFlagText = Object.fromEntries(textEntries);
  const typedOrder = textEntries.map(flagOfEntry);
  return { text, typedOrder };
}

/** Whether the entry is a flag with typed text after it. */
function isTextEntry(entry: readonly [CanvasFlag, FlagValue]): entry is TextEntry {
  const [flag, value] = entry;
  return flag !== 'help' && typeof value === 'string';
}

/** The flag an entry is for. */
function flagOfEntry(entry: TextEntry): TextFlag {
  const [flag] = entry;
  return flag;
}
