/*
 * Why this file exists
 *
 * Every API answer needs an HTTP status and the same JSON envelope, so callers can branch without
 * reading messages. For example, a `revision-conflict` failure is sent with status 409, inside the
 * envelope `{ version: 1, generation, outcome }` (a `TransportResponse`). `generation` names this
 * server run; it changes on every restart.
 *
 * This file chooses the status for each failure code and puts the outcome in that envelope. It
 * never changes a failure; clients branch on its code and status, never on its message.
 */
import type { TransportResponse } from '../../contract/records/transport/protocol.js';
import type {
  HttpStatus,
  HttpErrorCode,
  HttpOutcome,
} from '../../contract/records/transport/http-codes.js';
import type { Generation } from '../../contract/brands.js';

/** A status for a refused outcome. */
type FailureStatus = Exclude<HttpStatus, 200>;

/**
 * Chooses the HTTP status for the outcome: 200 when it worked, otherwise the status of its failure
 * code, such as 422 for `invalid-input` or 409 for `conflict`. Never fails.
 */
export function chooseHttpStatus(outcome: HttpOutcome): HttpStatus {
  if (outcome.ok) return 200;
  return FAILURE_STATUS[outcome.error.code];
}

/**
 * Puts the outcome in the envelope every answer has: `{ version: 1, generation, outcome }`. A
 * success with no value is sent with the value `null`, so the envelope stays valid JSON.
 */
export function buildTransportResponse(
  outcome: HttpOutcome,
  generation: Generation,
): TransportResponse {
  return { version: 1, generation, outcome: wireValue(outcome) };
}

/** The outcome as sent: a failure unchanged, a success with `undefined` replaced by `null`. */
function wireValue(outcome: HttpOutcome): HttpOutcome {
  if (!outcome.ok) return outcome;
  return { ok: true, value: outcome.value ?? null };
}

/**
 * The status of each wire code: 401 refused credentials, 403 refused permission, 404 missing,
 * 409 a generation, revision or request-ID conflict (`conflict`, `revision-conflict`,
 * `request-reused`) or a cancellation (`cancelled`), 503 an unavailable dependency, and 422 for
 * every other code, including `constraint-conflict` (the caller corrects its input).
 */
const FAILURE_STATUS: Readonly<Record<HttpErrorCode, FailureStatus>> = Object.freeze({
  'invalid-input': 422,
  unauthorized: 401,
  'not-found': 404,
  unavailable: 503,
  conflict: 409,
  cancelled: 409,
  'unsupported-version': 422,
  'unknown-reference': 422,
  'invariant-violation': 422,
  'constraint-conflict': 422,
  'revision-conflict': 409,
  'request-reused': 409,
  'missing-asset': 422,
  'permission-denied': 403,
  'storage-unavailable': 503,
  'corrupt-record': 422,
  'unsupported-media': 422,
  'unsafe-media': 422,
  'corrupt-asset': 422,
  'lease-expired': 422,
  'missing-preset': 422,
  'digest-mismatch': 422,
  'version-exists': 422,
  'duplicate-preset': 422,
  'dependency-cycle': 422,
  'provider-failed': 422,
});
