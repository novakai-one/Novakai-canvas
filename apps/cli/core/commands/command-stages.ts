/*
 * Why this file exists
 *
 * `parse.ts` checks a typed line one check at a time, and each check hands the next what it has
 * checked so far. In `pnpm canvas read my-diagram`, one check finds the command `read` and its
 * operand (the word after it) `my-diagram`. The next checks that `read` got exactly one operand.
 *
 * This file names what each check hands on, in the order they are made, so a type says how far
 * the checking got. It holds types only, and never checks a value: words and flags are as typed.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';
import type { CommandName } from '../../contract/records/command.js';
import type { FlagValue, FlagTextAsTyped, TypedFlags } from './flags.js';
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

/**
 * A command with the right number of operands: none for `help`, `describe` or `list`, one for any
 * other. Its flags aren't checked yet.
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

/** An `AcceptedCommand` for `help`, `describe` or `list`: the command alone, and its flags. */
export interface AcceptedNoOperandCommand {
  readonly kind: 'no-operand';
  readonly name: NoOperandCommand;
  readonly flags: FlagTextAsTyped;
}

/**
 * An `AcceptedCommand` for any other command: the command, its one operand as typed
 * (`my-diagram` in `read my-diagram`), and its flags.
 */
export interface AcceptedOneOperandCommand {
  readonly kind: 'one-operand';
  readonly name: OneOperandCommand;
  readonly operand: string;
  readonly flags: FlagTextAsTyped;
}

/**
 * A command whose flags are all ones it accepts. Only `checkAcceptedFlags` makes one. Its flags
 * keep their text but not their order.
 */
export type AcceptedCommand = AcceptedNoOperandCommand | AcceptedOneOperandCommand;
