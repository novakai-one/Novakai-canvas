/*
 * Why this file exists
 *
 * Every command needs a set number of words after it. `list` needs none. `read` needs exactly one,
 * the collection to read: `pnpm canvas read my-diagram`. That word is called the operand. So
 * `pnpm canvas read` alone, or `read a b`, is a mistake:
 *
 *   invalid-arguments: read requires 1 operand(s)
 *
 * This file checks the number of words after the command. Which commands need none is written
 * once, in `table.ts`. The count is checked before any flag. It never checks what the word says;
 * that happens later, in `assembly.ts`.
 */
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import type { CommandWithRightOperandCount, IdentifiedCommand } from './command-stages.js';
import { operandCountFailure } from './failures.js';
import type { TypedFlags } from './flags.js';
import { takesNoOperand } from './table.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/**
 * Checks the command got the number of words it needs after it: none for `help`, `describe` and
 * `list`, and exactly one for every other command.
 *
 * The mistake it can find: too many or too few words (`invalid-arguments`).
 */
export function checkOperandCount(
  identified: IdentifiedCommand,
): Result<CommandWithRightOperandCount> {
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
  flags: TypedFlags,
): Result<CommandWithRightOperandCount> {
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
  flags: TypedFlags,
): Result<CommandWithRightOperandCount> {
  const [operand, ...extraWords] = operandWords;
  const hasExactlyOne = operand !== undefined && extraWords.length === 0;
  if (!hasExactlyOne) {
    return operandCountFailure(name, 1);
  }
  return success({ kind: 'one-operand', name, operand, flags });
}
