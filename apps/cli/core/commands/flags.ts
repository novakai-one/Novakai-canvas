/*
 * Flag text as the user typed it, before any value is checked: which flags carry text, the text of
 * each, and the order they were given. Pure. `parse.ts` reads them from Node's values; the value
 * checks (`values.ts`, `recipe-values.ts`, `profile-commands.ts`) mint each flag's brand and fill
 * its default.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';

/** A flag that carries text: every flag but the `--help` switch. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/** Each text flag as given; an absent flag is an omitted key. Each value's check fills its default. */
export type CommandFlags = Readonly<Partial<Record<TextFlag, string>>>;

/** The text flags given: the text of each, and their names in the order Node read them. */
export interface GivenFlags {
  readonly text: CommandFlags;
  /** Used only to name the first flag a command does not accept. */
  readonly givenOrder: readonly TextFlag[];
}

/** The --workspace text used when the flag is absent: the executable's default workspace. */
export type WorkspaceText = string;

/** Node's value for one flag: text for a text flag, `true` for a switch. */
type FlagValue = string | boolean;

/** One text flag and its text. */
type TextEntry = [TextFlag, string];

/** The text flags among Node's values, and the order they were given. `--help` is left out. */
export function readGivenFlags(flagValues: ReadonlyMap<CanvasFlag, FlagValue>): GivenFlags {
  const textEntries = [...flagValues].filter(isTextEntry);
  const text: CommandFlags = Object.fromEntries(textEntries);
  const givenOrder = textEntries.map(flagOfEntry);
  return { text, givenOrder };
}

/** Whether the entry is a text flag with its text. */
function isTextEntry(entry: readonly [CanvasFlag, FlagValue]): entry is TextEntry {
  const [flag, value] = entry;
  return flag !== 'help' && typeof value === 'string';
}

/** The flag an entry names. */
function flagOfEntry(entry: TextEntry): TextFlag {
  const [flag] = entry;
  return flag;
}
