/*
 * Connection failures: every refusal in the connection pipeline carries the recovery text the
 * panel shows, so the shared `failure` helper's fixed recovery text does not fit.
 */
import { diagnostic, type Result } from '../../../contract/errors.js';
import type { GestureCode, JournalCode } from '../../../contract/records/error-codes.js';

/** One connection failure with the recovery text the panel shows. */
export function connectionFailure<T>(
  code: GestureCode | Extract<JournalCode, 'pending-request'>,
  message: string,
  recovery: string,
): Result<T> {
  return { ok: false, error: diagnostic(code, message, recovery) };
}
