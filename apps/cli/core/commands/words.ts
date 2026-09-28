/*
 * The grammar's answer, handed to command assembly: a known command, its operand and its flag
 * text. Pure declaration. `parse.ts` builds it after its word, operand and placement checks;
 * `operands.ts` checks every value in it.
 */
import type { CommandName } from '../../contract/records/command.js';
import type { CommandFlags } from './flags.js';

/**
 * A known command with exactly the operands it takes and only the flags it reads. Every value is
 * still text as the user gave it.
 */
export interface CommandWords {
  readonly name: CommandName;
  /** The command's one operand; `''` for a command that takes none, whose checks never read it. */
  readonly operand: string;
  readonly flags: CommandFlags;
}
