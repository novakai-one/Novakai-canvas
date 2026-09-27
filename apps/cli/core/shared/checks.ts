/*
 * A schema check as a Result. Pure. Core uses a schema's `safeParse` only, so it does not import
 * the schema library; a rejected value becomes the failure its caller names.
 */
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** The part of a schema a check uses. Declared here so core does not import zod. */
export interface Parser<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

/** `input` as the checked, branded value `parser` mints; otherwise the failure `rejectedAs`. */
export function checked<T>(
  parser: Parser<T>,
  input: unknown,
  rejectedAs: FailureInput,
): Result<T> {
  const parsed = parser.safeParse(input);
  if (!parsed.success) return failure(rejectedAs);
  return success(parsed.data);
}
