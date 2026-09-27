/*
 * What the grammar hands to command assembly: the command word, its operand and the flag text as
 * given, plus the defaults the executable supplies. Pure. `parse.ts` builds `CommandWords` after its
 * word, operand and placement checks; `operands.ts` and the value checks read them.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';
import type { CommandName } from '../../contract/records/command.js';

/** A flag that carries text: every flag but the `--help` switch. */
export type TextFlag = Exclude<CanvasFlag, 'help'>;

/** Each text flag as given; an absent flag is an omitted key. Each value's check fills its default. */
export type CommandFlags = Readonly<Partial<Record<TextFlag, string>>>;

/** A known command word with the right operand count, and flags placed where they are accepted. */
export interface CommandWords {
  readonly name: CommandName;
  /** The command's one operand; `''` for a command that takes none. */
  readonly operand: string;
  readonly flags: CommandFlags;
}

/** What the executable supplies: the workspace directory when --workspace is absent. */
export interface CommandDefaults {
  readonly workspace: string;
}

/** The text flags among Node's values; the `--help` switch is read by the grammar. */
export function flagText(values: ReadonlyMap<CanvasFlag, string | boolean>): CommandFlags {
  return Object.fromEntries([...values].filter(isTextEntry));
}

/** Whether the entry is a text flag with its text. */
function isTextEntry(entry: readonly [CanvasFlag, string | boolean]): entry is [TextFlag, string] {
  return entry[0] !== 'help' && typeof entry[1] === 'string';
}
