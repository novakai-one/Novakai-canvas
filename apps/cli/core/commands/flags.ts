/*
 * Flag text as the user gave it, before any value is checked: which flags carry text, the text of
 * each, and the default the executable supplies. Pure. `parse.ts` reads the text from Node's
 * values; the value checks (`values.ts`, `recipe-values.ts`, `profile-operands.ts`) mint each
 * flag's brand and fill its default.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';

/** A flag that carries text: every flag but the `--help` switch. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/** Each text flag as given; an absent flag is an omitted key. Each value's check fills its default. */
export type CommandFlags = Readonly<Partial<Record<TextFlag, string>>>;

/** What the executable supplies: the --workspace text to use when the flag is absent. */
export interface CommandDefaults {
  readonly workspace: string;
}

/** Node's value for one flag: text for a text flag, `true` for a switch. */
type FlagValue = string | boolean;

/**
 * The text flags among Node's values, in the order given. The `--help` switch is left out: the
 * grammar reads it.
 */
export function readTextFlags(flagValues: ReadonlyMap<CanvasFlag, FlagValue>): CommandFlags {
  const textEntries = [...flagValues].filter(isTextEntry);
  return Object.fromEntries(textEntries);
}

/** Whether the entry is a text flag with its text. */
function isTextEntry(entry: readonly [CanvasFlag, FlagValue]): entry is [TextFlag, string] {
  const [flag, value] = entry;
  return flag !== 'help' && typeof value === 'string';
}
