/*
 * A schema check as a Result. Pure. Core uses a schema's `safeParse` only, through the contract's
 * `Parser`, so it does not import the schema library; a rejected value becomes the failure its
 * caller names.
 */
import type { Parser } from '../../contract/schemas.js';
import type { FailureInput, LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** `input` as the checked, branded value `parser` mints; otherwise the failure `rejectedAs`. */
export function checked<T>(
  parser: Parser<T>,
  input: unknown,
  rejectedAs: FailureInput,
): Result<T, LocalFailure> {
  const parsed = parser.safeParse(input);
  if (!parsed.success) return failure(rejectedAs);
  return success(parsed.data);
}
