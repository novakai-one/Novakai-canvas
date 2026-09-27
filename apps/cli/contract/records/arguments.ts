/*
 * `pnpm canvas` argv after the argument adapter: the command word, its operand and the flag
 * values as given. Pure declarations. The adapter checks only which words and flags a command
 * accepts; core checks each value and builds the `ParsedCommand`.
 */
import type { CommandName, ServiceOptions } from './command.js';

/** Flag values as given. An absent flag is an omitted key; `--mode` defaults to `create`. */
export interface CommandFlags {
  readonly mode: string;
  readonly revision?: string;
  readonly request?: string;
  readonly out?: string;
  readonly id?: string;
  readonly version?: string;
  readonly family?: string;
  readonly title?: string;
  readonly namespace?: string;
  readonly profile?: string;
  readonly section?: string;
  readonly object?: string;
}

/** A known command word with the right operand count, and flags placed where they are accepted. */
export interface CommandArguments {
  readonly name: CommandName;
  /** The command's one operand; `''` for `help`, `describe` and `list`, which take none. */
  readonly operand: string;
  readonly flags: CommandFlags;
  readonly options: ServiceOptions;
}
