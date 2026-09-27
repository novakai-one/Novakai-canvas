/*
 * The HTTP answer for an outcome: its status, chosen by the failure's wire code, and its
 * versioned JSON envelope. Pure. Clients branch on the code and status, never on the message; they
 * keep their draft and request ID and reconcile the receipt before retrying.
 */
import type { TransportResponse } from '../../contract/records/transport/protocol.js';
import type {
  HttpStatus,
  WireErrorCode,
  WireOutcome,
} from '../../contract/records/transport/wire-codes.js';
import type { Generation } from '../../contract/brands.js';

/** A status for a refused outcome. */
type FailureStatus = Exclude<HttpStatus, 200>;

/** 200 for a success; otherwise the status of the failure's wire code (`FAILURE_STATUS`). */
export function httpStatus(outcome: WireOutcome): HttpStatus {
  if (outcome.ok) return 200;
  return FAILURE_STATUS[outcome.error.code];
}

/**
 * The version 1 envelope carrying the server's generation and the outcome. A success with no value
 * (a void owner success) carries an explicit JSON `null`, so the envelope stays valid.
 */
export function transportResponse(
  outcome: WireOutcome,
  generation: Generation,
): TransportResponse {
  return { version: 1, generation, outcome: wireValue(outcome) };
}

/** The outcome as sent: a failure unchanged, a success with `undefined` replaced by `null`. */
function wireValue(outcome: WireOutcome): WireOutcome {
  if (!outcome.ok) return outcome;
  return { ok: true, value: outcome.value ?? null };
}

/**
 * The status of each wire code: 401 refused credentials, 403 refused permission, 404 missing,
 * 409 a conflict or cancellation to reconcile, 503 an unavailable dependency, and 422 for every
 * other refusal (the caller corrects its input).
 */
const FAILURE_STATUS: Readonly<Record<WireErrorCode, FailureStatus>> = Object.freeze({
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
