/*
 * How many words a command takes after its name: none for `help`, `describe` and `list`, exactly
 * one for every other command (`takesNoOperand` in `table.ts`). Pure. A wrong count fails before
 * any flag or value is checked; nothing was read or sent.
 */
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import type { CountedCommand, IdentifiedCommand } from './command-stages.js';
import { operandCountFailure } from './failures.js';
import type { GivenFlags } from './flags.js';
import { takesNoOperand } from './table.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/**
 * The command with exactly the operand it takes. Fails with `invalid-arguments` for any other
 * number of words.
 */
export function countOperand(identified: IdentifiedCommand): Result<CountedCommand> {
  const { name, operandWords, flags } = identified;
  if (takesNoOperand(name)) {
    return requireNoOperand(name, operandWords, flags);
  }
  return requireOneOperand(name, operandWords, flags);
}

/** The command and its flags, when no word follows it. Fails with `invalid-arguments`. */
function requireNoOperand(
  name: NoOperandCommand,
  operandWords: readonly string[],
  flags: GivenFlags,
): Result<CountedCommand> {
  if (operandWords.length > 0) {
    return operandCountFailure(name, 0);
  }
  return success({ kind: 'no-operand', name, flags });
}

/**
 * The command, its one operand and its flags. Fails with `invalid-arguments` for no word, or two
 * or more.
 */
function requireOneOperand(
  name: OneOperandCommand,
  operandWords: readonly string[],
  flags: GivenFlags,
): Result<CountedCommand> {
  const [operand, ...extraWords] = operandWords;
  const hasExactlyOne = operand !== undefined && extraWords.length === 0;
  if (!hasExactlyOne) {
    return operandCountFailure(name, 1);
  }
  return success({ kind: 'one-operand', name, operand, flags });
}
