/*
 * Why this file exists
 *
 * `parse.ts` checks a typed command line in steps, and each step hands the next one what it has
 * checked so far. The word typed after a command is called its operand: `my-diagram` in
 * `pnpm canvas read my-diagram --section intro`. For that line, the steps hand on:
 *
 *   1. `WellFormedArguments`: every flag could be read, and neither `--section` nor `--object`
 *      was typed twice.
 *   2. `IdentifiedCommand`: the command is `read`, and `my-diagram` was typed after it.
 *   3. `CommandWithRightOperandCount`: `read` got the one operand it needs.
 *   4. `AcceptedCommand`: `read` accepts `--section`, so every flag fits. It is either an
 *      `AcceptedNoOperandCommand` (such as `list`) or an `AcceptedOneOperandCommand` (such as
 *      `read my-diagram`).
 *
 * This file names what each step hands on, so each step's type says how far the checking got.
 * Every word and flag value in them is still the text as typed. `assembly.ts` checks them last,
 * using the checks in `values.ts`.
 *
 * Step 4 drops the order the flags were typed in; it was only needed to name the first flag the
 * command doesn't accept.
 *
 * It holds types only. No code runs here.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';
import type { CommandName } from '../../contract/records/command.js';
import type { FlagValue, FlagTextAsTyped, FlagTextAndOrder } from './flags.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/**
 * Step 1: the words and flags of a line where every flag could be read, and neither `--section`
 * nor `--object` was typed twice.
 */
export interface WellFormedArguments {
  /** The words that aren't flags, in order: `['read', 'my-diagram']`. */
  readonly words: readonly string[];
  /** What Node read for each flag: the text typed after it, or `true` for `--help`. */
  readonly flagValues: ReadonlyMap<CanvasFlag, FlagValue>;
}

/** Step 2: a known command, the words typed after it (not counted yet), and its flags as typed. */
export interface IdentifiedCommand {
  readonly name: CommandName;
  /** The words after the command: `['my-diagram']` in `read my-diagram`. */
  readonly operandWords: readonly string[];
  readonly flags: FlagTextAndOrder;
}

/**
 * Step 3: a command with the right number of operands. Its flags aren't checked yet.
 * - `no-operand`: `help`, `describe` or `list`, typed alone.
 * - `one-operand`: any other command, with its one `operand` as typed, such as `my-diagram`.
 */
export type CommandWithRightOperandCount =
  | {
      readonly kind: 'no-operand';
      readonly name: NoOperandCommand;
      readonly flags: FlagTextAndOrder;
    }
  | {
      readonly kind: 'one-operand';
      readonly name: OneOperandCommand;
      readonly operand: string;
      readonly flags: FlagTextAndOrder;
    };

/** Step 4, for `help`, `describe` or `list`: the command, typed alone, and its accepted flags. */
export interface AcceptedNoOperandCommand {
  readonly kind: 'no-operand';
  readonly name: NoOperandCommand;
  readonly flags: FlagTextAsTyped;
}

/**
 * Step 4, for any other command: the command, its one operand as typed (`my-diagram` in
 * `read my-diagram`), and its accepted flags.
 */
export interface AcceptedOneOperandCommand {
  readonly kind: 'one-operand';
  readonly name: OneOperandCommand;
  readonly operand: string;
  readonly flags: FlagTextAsTyped;
}

/** Step 4: a command whose flags are all ones it accepts. Only `checkCommandFlags` makes one. */
export type AcceptedCommand = AcceptedNoOperandCommand | AcceptedOneOperandCommand;
