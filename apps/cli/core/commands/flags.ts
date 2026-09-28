/*
 * Why this file exists
 *
 * Node reads `--section intro` as the flag `section` with the text `intro`. Nothing is checked
 * yet, so the CLI keeps that text exactly as typed, and the types here say so.
 *
 * This file collects the text typed after each flag, and the order the flags were typed in. It
 * never checks a value: each value is checked later (see `assembly.ts`).
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';

/** A flag typed with text after it, such as `--revision 3`. That's every flag except `--help`. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/**
 * The text typed after each flag, exactly as the agent typed it, not checked yet:
 * `{ revision: '3' }` for `--revision 3`. A flag that wasn't typed is left out.
 */
export type FlagTextAsTyped = Readonly<Partial<Record<TextFlag, string>>>;

/** The text typed after each flag, and the order the flags were typed in. Not checked yet. */
export interface TypedFlags {
  /** The text typed after each flag: `{ revision: '3' }` for `--revision 3`. */
  readonly text: FlagTextAsTyped;
  /** The flags in the order typed. Kept only to name the first one a command doesn't accept. */
  readonly order: readonly TextFlag[];
}

/** What Node's `parseArgs` read for one flag: the typed text, or `true` for `--help`. */
export type FlagValue = string | boolean;

/** One flag and the text typed after it. */
type TextEntry = [TextFlag, string];

/**
 * Collects the text typed after each flag, and the order the flags were typed in.
 *
 * `--revision 3 --out a.canvas` gives `{ revision: '3', out: 'a.canvas' }` and
 * `['revision', 'out']`. `--help` is left out: it has no text.
 */
export function collectTypedFlags(flagValues: ReadonlyMap<CanvasFlag, FlagValue>): TypedFlags {
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
