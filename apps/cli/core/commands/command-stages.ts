/*
 * Why this file exists
 *
 * `parse.ts` checks a typed line in steps, and each step hands the next what it has checked so
 * far. In `pnpm canvas read my-diagram`, one step finds the command `read` and its operand (the
 * word after it) `my-diagram`. The next checks that `read` got exactly one operand.
 *
 * This file names what each step hands on, so a type says how far the checking got. It holds
 * types only, and never checks a value: every word and flag in them is still text as typed.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';
import type { CommandName } from '../../contract/records/command.js';
import type { FlagValue, FlagTextAsTyped, TypedFlags } from './flags.js';
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
  readonly flags: TypedFlags;
}

/**
 * Step 3: a command with the right number of operands: none for `help`, `describe` or `list`, one
 * for any other. Its flags aren't checked yet.
 */
export type CommandWithRightOperandCount =
  | {
      readonly kind: 'no-operand';
      readonly name: NoOperandCommand;
      readonly flags: TypedFlags;
    }
  | {
      readonly kind: 'one-operand';
      readonly name: OneOperandCommand;
      readonly operand: string;
      readonly flags: TypedFlags;
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

/**
 * Step 4: a command whose flags are all ones it accepts. Only `checkAcceptedFlags` makes one. Its
 * flags keep their text but not their order.
 */
export type AcceptedCommand = AcceptedNoOperandCommand | AcceptedOneOperandCommand;
