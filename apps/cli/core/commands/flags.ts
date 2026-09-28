/*
 * Flag text as the user typed it, before any value is checked: which flags carry text, and the
 * text of each. Pure. `parse.ts` collects the text from Node's values; the value checks
 * (`values.ts`, `recipe-values.ts`, `profile-operands.ts`) mint each flag's brand and fill its
 * default.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';

/** A flag that carries text: every flag but the `--help` switch. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/** Each text flag as given; an absent flag is an omitted key. Each value's check fills its default. */
export type CommandFlags = Readonly<Partial<Record<TextFlag, string>>>;

/** Node's value for one flag: text for a text flag, `true` for a switch. */
type FlagValue = string | boolean;

/**
 * The text flags among Node's values, in the order they were given; `placement.ts` names the first
 * flag a command does not accept in this order. The `--help` switch is left out: `parse.ts` reads
 * it.
 */
export function collectCommandFlags(flagValues: ReadonlyMap<CanvasFlag, FlagValue>): CommandFlags {
  const textEntries = [...flagValues].filter(isTextEntry);
  return Object.fromEntries(textEntries);
}

/** Whether the entry is a text flag with its text. */
function isTextEntry(entry: readonly [CanvasFlag, FlagValue]): entry is [TextFlag, string] {
  const [flag, value] = entry;
  return flag !== 'help' && typeof value === 'string';
}
