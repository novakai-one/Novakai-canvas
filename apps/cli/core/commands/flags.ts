/*
 * Flag text as the user typed it, before any value is checked: which flags carry text, and the
 * text of each. Pure. `parse.ts` reads the text from Node's values; the value checks
 * (`values.ts`, `recipe-values.ts`, `profile-operands.ts`) mint each flag's brand and fill its
 * default.
 */
import { canvasFlags } from '../../contract/records/arguments.js';
import type { CanvasFlag } from '../../contract/records/arguments.js';

/** A flag that carries text: every flag but the `--help` switch. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/** Each text flag as given; an absent flag is an omitted key. Each value's check fills its default. */
export type CommandFlags = Readonly<Partial<Record<TextFlag, string>>>;

/** Node's value for one flag: text for a text flag, `true` for a switch. */
type FlagValue = string | boolean;

/**
 * The text flags among Node's values, in the order they were given. The `--help` switch is left
 * out: `parse.ts` reads it.
 */
export function readTextFlags(flagValues: ReadonlyMap<CanvasFlag, FlagValue>): CommandFlags {
  const textEntries = [...flagValues].filter(isTextEntry);
  // `Object.fromEntries` types every key as `string`; `isTextEntry` let only text flags through.
  // Its keys keep the order they were added, so `listGivenFlags` returns Node's order.
  return Object.fromEntries(textEntries);
}

/** The text flags given, in the order Node read them (see `readTextFlags`). */
export function listGivenFlags(flags: CommandFlags): readonly TextFlag[] {
  const givenKeys = Object.keys(flags);
  return givenKeys.filter(isTextFlag);
}

/** Whether the entry is a text flag with its text. */
function isTextEntry(entry: readonly [CanvasFlag, FlagValue]): entry is [TextFlag, string] {
  const [flag, value] = entry;
  return flag !== 'help' && typeof value === 'string';
}

/** Whether `key` names a text flag; `readTextFlags` keeps no other key. */
function isTextFlag(key: string): key is TextFlag {
  return key !== 'help' && Object.hasOwn(canvasFlags, key);
}
