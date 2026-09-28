/*
 * The failure the command-line checks share: `invalid-arguments`, for an argument that is
 * malformed, missing, misplaced or in conflict with another. Pure. Nothing was read or sent, so
 * the caller corrects the argument and runs the command again.
 */
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/** `invalid-arguments` with `message`, which names the argument to correct. */
export function invalidArguments(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}
