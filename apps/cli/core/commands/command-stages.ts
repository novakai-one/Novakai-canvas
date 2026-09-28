/*
 * What each check of a `pnpm canvas` command line hands to the next, in order: the command line,
 * well-formed arguments, an identified command, a counted command, then an accepted command. Every
 * value is still the text as typed; `assembly.ts` checks the values. Pure declarations.
 */
import type { CanvasFlag } from '../../contract/records/arguments.js';
import type { CommandName } from '../../contract/records/command.js';
import type { CommandFlags, GivenFlags } from './flags.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/** The words and flag values Node read, with no flag refused and neither scope flag given twice. */
export interface WellFormedArguments {
  readonly positionals: readonly string[];
  readonly values: ReadonlyMap<CanvasFlag, string | boolean>;
}

/** A known command, the words typed after it (not yet counted), and its flags as given. */
export interface IdentifiedCommand {
  readonly name: CommandName;
  readonly operandWords: readonly string[];
  readonly flags: GivenFlags;
}

/** `help`, `describe` or `list`: no word follows the name. */
export interface CommandWithoutOperand {
  readonly kind: 'no-operand';
  readonly name: NoOperandCommand;
}

/** Any other command, and the one word typed after its name. */
export interface CommandWithOperand {
  readonly kind: 'one-operand';
  readonly name: OneOperandCommand;
  readonly operand: string;
}

/** A command with exactly the operand it takes, and its flags as given (not yet checked). */
export type CountedCommand = (CommandWithoutOperand | CommandWithOperand) & {
  readonly flags: GivenFlags;
};

/** An accepted command that takes no operand. */
export type AcceptedWithoutOperand = CommandWithoutOperand & { readonly flags: CommandFlags };

/** An accepted command and its one operand. */
export type AcceptedWithOperand = CommandWithOperand & { readonly flags: CommandFlags };

/**
 * A counted command whose every flag is one it accepts; only `checkAcceptedFlags` makes one. The
 * flags keep their text only: their order was needed only to name a flag the command refuses.
 */
export type AcceptedCommand = AcceptedWithoutOperand | AcceptedWithOperand;
