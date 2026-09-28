/*
 * Why this file exists
 *
 * Each command needs a set number of words after it, called operands. `list` needs none. `read`
 * needs one, the collection to read: `pnpm canvas read my-diagram`. So `read` alone is a mistake.
 *
 * This file checks that number, before any flag is checked. It never checks what the word says:
 * each value is checked in `values.ts`.
 */
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import type { CommandWithRightOperandCount, IdentifiedCommand } from './command-stages.js';
import { operandCountFailure } from './failures.js';
import type { TypedFlags } from './flags.js';
import { takesNoOperand } from './table.js';
import type { NoOperandCommand, OneOperandCommand } from './table.js';

/**
 * Checks the command got the right number of words after it.
 *
 * `help`, `describe` and `list` take none. Every other command takes exactly one.
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
