/*
 * Why this file exists
 *
 * Most typed values are checked the same way: run a check, keep the checked value, or turn a
 * refusal into a mistake the agent can read. `pnpm canvas receipt "not a request"` fails the
 * request ID check and becomes `invalid-request: Request ID is invalid`.
 *
 * This file does that one step for any check (a `Parser`, see `contract/schemas.ts`). The caller
 * chooses the check and the mistake; this file never picks a failure code itself.
 */
import type { Parser } from '../../contract/schemas.js';
import type { FailureInput, LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Checks `input` with `parser`, and gives back the checked value, typed as the parser makes it
 * (such as `CollectionId`). If the parser refuses the input, it gives back `mistake` as a failure.
 */
export function checked<T>(
  parser: Parser<T>,
  input: unknown,
  mistake: FailureInput,
): Result<T, LocalFailure> {
  const parsed = parser.safeParse(input);
  if (!parsed.success) return failure(mistake);
  return success(parsed.data);
}
