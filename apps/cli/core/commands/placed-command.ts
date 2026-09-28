/*
 * What command-line reading hands to command assembly: a placed command, whose words and flags are
 * where the command takes them. Every value is still the text as typed. Pure declarations and one
 * guard. `parse.ts` places the operand, `placement.ts` checks each flag, `assembly.ts` checks each
 * value.
 */
import type { CommandFlags } from './flags.js';
import { takesNoOperand } from './table.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/** `help`, `describe` or `list`: no operand, and its flags. */
export interface PlacedWithoutOperand {
  readonly name: NoOperandCommand;
  readonly flags: CommandFlags;
}

/** Any other command: the one word typed after its name, and its flags. */
export interface PlacedWithOperand {
  readonly name: OneOperandCommand;
  readonly operand: string;
  readonly flags: CommandFlags;
}

/**
 * A placed command: a known command with exactly the operand it takes, and its flags. Once
 * `placement.ts` passes it, it holds only flags the command accepts.
 */
export type PlacedCommand = PlacedWithoutOperand | PlacedWithOperand;

/** Whether the command carries its one operand: every command but `help`, `describe` and `list`. */
export function hasOperand(placed: PlacedCommand): placed is PlacedWithOperand {
  return !takesNoOperand(placed.name);
}
