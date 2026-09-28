/*
 * Why this file exists
 *
 * `parse.ts` checks a typed command line in steps, and each step hands the next one what it has
 * checked so far. Take `pnpm canvas read my-diagram --section intro`:
 *
 *   1. `WellFormedArguments`: every flag could be read.
 *   2. `IdentifiedCommand`: the command is `read`, and `my-diagram` was typed after it.
 *   3. `CountedCommand`: `read` got the one word it needs after it.
 *   4. `AcceptedCommand`: `read` takes `--section`, so every flag fits.
 *
 * The word typed after a command (`my-diagram` here) is called its operand.
 *
 * This file names those in-between shapes, so each step's type says how far the checking got.
 * Every word and flag value in them is still the text as typed. Values such as `--revision 3` are
 * checked last, in `assembly.ts`.
 *
 * It holds types only. No code runs here.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';
import type { CommandName } from '../../contract/records/command.js';
import type { CommandFlags, GivenFlags } from './flags.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/**
 * The words and flags of a line where every flag could be read, and neither `--section` nor
 * `--object` was typed twice.
 */
export interface WellFormedArguments {
  /** The words that aren't flags, in order: `['read', 'my-diagram']`. */
  readonly positionals: readonly string[];
  /** The text typed after each flag, or `true` for `--help`. */
  readonly values: ReadonlyMap<CanvasFlag, string | boolean>;
}

/** A known command, the words typed after it (not counted yet), and its flags as typed. */
export interface IdentifiedCommand {
  readonly name: CommandName;
  /** The words after the command: `['my-diagram']` in `read my-diagram`. */
  readonly operandWords: readonly string[];
  readonly flags: GivenFlags;
}

/** `help`, `describe` or `list`, typed with no word after it. */
export interface CommandWithoutOperand {
  readonly kind: 'no-operand';
  readonly name: NoOperandCommand;
}

/** Any other command, and the one word typed after it. */
export interface CommandWithOperand {
  readonly kind: 'one-operand';
  readonly name: OneOperandCommand;
  /** The word after the command, as typed: `my-diagram` in `read my-diagram`. Checked later. */
  readonly operand: string;
}

/** A command with the right number of words after it. Its flags aren't checked yet. */
export type CountedCommand = (CommandWithoutOperand | CommandWithOperand) & {
  readonly flags: GivenFlags;
};

/** An accepted command typed with no word after it. */
export type AcceptedWithoutOperand = CommandWithoutOperand & { readonly flags: CommandFlags };

/** An accepted command, and the one word typed after it. */
export type AcceptedWithOperand = CommandWithOperand & { readonly flags: CommandFlags };

/**
 * A command whose flags are all ones it takes. Only `checkAcceptedFlags` makes one. It keeps the
 * text typed after each flag, but no longer the order the flags were typed in.
 */
export type AcceptedCommand = AcceptedWithoutOperand | AcceptedWithOperand;
