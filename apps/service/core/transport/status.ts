/*
 * The HTTP answer for an outcome: its status, chosen by the owner's failure code, and its
 * versioned JSON envelope. Pure. Clients branch on the code and status, never on the message; they
 * keep their draft and request ID and reconcile the receipt before retrying.
 */
import type { TransportResponse, WireOutcome } from '../../contract/records/transport/protocol.js';
import type { HttpStatus } from '../../contract/records/transport/server.js';

/** A status for a refused outcome. */
type FailureStatus = Exclude<HttpStatus, 200>;

/**
 * The status of each failure code that is not a correctable input refusal. Codes come from each
 * owner's closed list; every code not listed here answers `UNLISTED_STATUS`.
 */
const FAILURE_STATUS: ReadonlyMap<string, FailureStatus> = new Map<string, FailureStatus>([
  ['unauthorized', 401],
  ['permission-denied', 403],
  ['not-found', 404],
  ['conflict', 409],
  ['revision-conflict', 409],
  ['request-reused', 409],
  ['unavailable', 503],
  ['storage-unavailable', 503],
  ['cancelled', 409],
]);

/** The status of a failure code not in `FAILURE_STATUS`: the caller corrects its input. */
const UNLISTED_STATUS: FailureStatus = 422;

/** 200 for a success; otherwise the status of the failure code (422 when it is not listed). */
export function httpStatus(outcome: WireOutcome): HttpStatus {
  if (outcome.ok) return 200;
  return FAILURE_STATUS.get(outcome.error.code) ?? UNLISTED_STATUS;
}

/**
 * The version 1 envelope carrying the server's generation and the outcome. A success with no value
 * (a void owner success) carries an explicit JSON `null`, so the envelope stays valid.
 */
export function transportResponse(
  outcome: WireOutcome,
  generation: string,
): TransportResponse {
  return { version: 1, generation, outcome: wireValue(outcome) };
}

/** The outcome as sent: a failure unchanged, a success with `undefined` replaced by `null`. */
function wireValue(outcome: WireOutcome): WireOutcome {
  if (!outcome.ok) return outcome;
  return { ok: true, value: outcome.value ?? null };
}
