/*
 * Why this file exists
 *
 * When an agent types `--section intro`, Node's `parseArgs` reads `intro` as the value of
 * `--section`. The CLI keeps `intro` exactly as typed. Nothing is checked yet, so every value here
 * is plain text, and the types say so. Checking comes later: `assembly.ts` checks each value,
 * using the checks in `values.ts`. That is where `--revision 3` becomes a checked revision number.
 *
 * This file reads two things from what Node found, for the next steps: the text typed after each
 * flag, and the order the flags were typed in.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';

/** A flag typed with text after it, such as `--revision 3`. That's every flag except `--help`. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/**
 * The text typed after each flag, exactly as the agent typed it, not checked yet:
 * `{ revision: '3' }` for `--revision 3`. A flag that wasn't typed is left out.
 */
export type FlagTextAsTyped = Readonly<Partial<Record<TextFlag, string>>>;

/** The text typed after each flag, plus the order the flags were typed in. */
export interface FlagTextAndOrder {
  readonly text: FlagTextAsTyped;
  /** The flags in the order they were typed. Kept only to name the first one a command doesn't accept. */
  readonly order: readonly TextFlag[];
}

/** What Node's `parseArgs` read for one flag: the typed text, or `true` for `--help`. */
export type FlagValue = string | boolean;

/** One flag and the text typed after it. */
type TextEntry = [TextFlag, string];

/**
 * Reads the text typed after each flag, and the order the flags were typed in, from what Node
 * read. Leaves out `--help`, which has no text.
 */
export function readFlagTextAndOrder(
  flagValues: ReadonlyMap<CanvasFlag, FlagValue>,
): FlagTextAndOrder {
  const textEntries = [...flagValues].filter(isTextEntry);
  const text: FlagTextAsTyped = Object.fromEntries(textEntries);
  const order = textEntries.map(flagOfEntry);
  return { text, order };
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
