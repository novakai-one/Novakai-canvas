/*
 * Why this file exists
 *
 * `parse.ts` checks a typed command line in steps, and each step hands the next one what it has
 * checked so far. Take `pnpm canvas read my-diagram --section intro`:
 *
 *   1. `WellFormedArguments`: every flag could be read.
 *   2. `IdentifiedCommand`: the command is `read`, and `my-diagram` was typed after it.
 *   3. `CommandWithRightOperandCount`: `read` got the one word it needs after it.
 *   4. `AcceptedCommand`: `read` takes `--section`, so every flag fits. It is one of two shapes:
 *      `AcceptedNoOperandCommand` (such as `list`) or `AcceptedOneOperandCommand` (such as
 *      `read my-diagram`).
 *
 * The word typed after a command (`my-diagram` here) is called its operand.
 *
 * This file names those in-between shapes, so each step's type says how far the checking got.
 * Every word and flag value in them is still the text as typed. Values such as `--revision 3` are
 * checked last, in `assembly.ts`.
 *
 * Each shape's `flags` holds the typed flags. Up to step 3 that is `TypedFlags`: the text after
 * each flag and the order they were typed in. From step 4 it is only the text (`TypedFlagText`),
 * because the order was needed only to name the first flag the command doesn't take.
 *
 * It holds types only. No code runs here.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';
import type { CommandName } from '../../contract/records/command.js';
import type { FlagValue, TypedFlagText, TypedFlags } from './flags.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/**
 * The words and flags of a line where every flag could be read, and neither `--section` nor
 * `--object` was typed twice.
 */
export interface WellFormedArguments {
  /** The words that aren't flags, in order: `['read', 'my-diagram']`. */
  readonly words: readonly string[];
  /** What Node read for each flag: the text typed after it, or `true` for `--help`. */
  readonly flagValues: ReadonlyMap<CanvasFlag, FlagValue>;
}

/** A known command, the words typed after it (not counted yet), and its flags as typed. */
export interface IdentifiedCommand {
  readonly name: CommandName;
  /** The words after the command: `['my-diagram']` in `read my-diagram`. */
  readonly operandWords: readonly string[];
  readonly flags: TypedFlags;
}

/** `help`, `describe` or `list`, typed with no operand. */
interface WithNoOperand {
  readonly kind: 'no-operand';
  readonly name: NoOperandCommand;
}

/** Any other command, typed with exactly one operand. */
interface WithOneOperand {
  readonly kind: 'one-operand';
  readonly name: OneOperandCommand;
  /** The word after the command, as typed: `my-diagram` in `read my-diagram`. Checked later. */
  readonly operand: string;
}

/** A command with the right number of words after it. Its flags aren't checked yet. */
export type CommandWithRightOperandCount = (WithNoOperand | WithOneOperand) & {
  readonly flags: TypedFlags;
};

/** An accepted command typed with no operand, such as `list`. */
export type AcceptedNoOperandCommand = WithNoOperand & { readonly flags: TypedFlagText };

/** An accepted command and its one operand, such as `read my-diagram`. */
export type AcceptedOneOperandCommand = WithOneOperand & { readonly flags: TypedFlagText };

/**
 * A command whose flags are all ones it takes. Only `checkAcceptedFlags` makes one. It keeps the
 * text typed after each flag, but no longer the order the flags were typed in.
 */
export type AcceptedCommand = AcceptedNoOperandCommand | AcceptedOneOperandCommand;
