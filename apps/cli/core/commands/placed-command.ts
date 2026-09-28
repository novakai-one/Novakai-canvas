/*
 * What command-line reading hands to command assembly: a known command, exactly the operand it
 * takes and only the flags it accepts, every value still text as typed. Pure declarations and one
 * guard. `parse.ts` counts the operand, `placement.ts` adds the flags, `operands.ts` checks each
 * value.
 */
import type { CommandFlags } from './flags.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/** A known command with exactly the operand it takes: none, or the one word after its name. */
export type CountedCommand =
  | { readonly name: NoOperandCommand }
  | { readonly name: OneOperandCommand; readonly operand: string };

/** `help`, `describe` or `list`, with the flags it accepts. */
export interface PlacedWithoutOperand {
  readonly name: NoOperandCommand;
  readonly flags: CommandFlags;
}

/** Any other command, with its one operand and the flags it accepts. */
export interface PlacedWithOperand {
  readonly name: OneOperandCommand;
  readonly operand: string;
  readonly flags: CommandFlags;
}

/** A counted command with the flags it accepts. */
export type PlacedCommand = PlacedWithoutOperand | PlacedWithOperand;

/** Whether the command carries its one operand. */
export function hasOperand(placed: PlacedCommand): placed is PlacedWithOperand {
  return 'operand' in placed;
}
