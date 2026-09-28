/*
 * Why this file exists
 *
 * When an agent types `--section intro`, the CLI first keeps `intro` exactly as typed. Nothing is
 * checked yet, so every value here is plain text, and the types say so. Checking comes later, in
 * `values.ts`: that is where `--revision 3` becomes a checked revision number and `--workspace`
 * becomes a checked folder path.
 *
 * This file only sorts the typed flags into two things the next steps need: the text typed after
 * each flag, and the order the flags were typed in.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';

/** A flag that is followed by a value. That's every flag except `--help`, which stands alone. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/** The text typed after each flag, exactly as typed. A flag that wasn't typed is left out. */
export type CommandFlags = Readonly<Partial<Record<TextFlag, string>>>;

/** The typed flags: the text after each one, and the order they were typed in. */
export interface GivenFlags {
  readonly text: CommandFlags;
  /** Kept only so a mistake can name the first flag the command doesn't use. */
  readonly givenOrder: readonly TextFlag[];
}

/** What Node read for one flag: the typed text, or `true` for `--help`. */
type FlagValue = string | boolean;

/** One flag and the text typed after it. */
type TextEntry = [TextFlag, string];

/** Sorts Node's flags into the text after each one and the order they were typed. Skips `--help`. */
export function readGivenFlags(flagValues: ReadonlyMap<CanvasFlag, FlagValue>): GivenFlags {
  const textEntries = [...flagValues].filter(isTextEntry);
  const text: CommandFlags = Object.fromEntries(textEntries);
  const givenOrder = textEntries.map(flagOfEntry);
  return { text, givenOrder };
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
