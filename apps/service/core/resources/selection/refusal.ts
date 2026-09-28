/*
 * Why this file exists
 *
 * Picking a request's themes and files asks several capabilities, and any of them can refuse. For
 * example, Language refuses DSL it can't parse, and Assets refuses a digest it doesn't store. The
 * selector reports all of these the same way, so the caller can branch on one code.
 *
 * This file makes those mistakes: `missing-asset` at `resources` when a theme or file can't be
 * used (the capability's own failure kept as `source`), and `invalid-input` at `resources` when
 * part of the request can't be read. A mistake is always found before anything is held or saved.
 */
import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import type { AuthoringResult } from '../../../contract/records/capability-types.js';
import { authoringFailure } from '../../../contract/errors.js';

/**
 * Passes a capability's answer on. A refusal becomes `missing-asset` at `resources`, "The owning
 * capability rejected this input", with the capability's failure kept as `source`.
 */
export function fromCapability<Value>(
  answer: AuthoringResult<Value, FailureSource>,
): AuthoringResult<Value> {
  if (!answer.ok) {
    return capabilityRefusedFailure(answer.error);
  }
  return answer;
}

/**
 * Makes the mistake for a theme or file that can't be used: `missing-asset` at `resources` with
 * this message, and the capability's failure as `source` when a capability refused.
 */
export function missingAssetFailure(
  message: string,
  source?: FailureSource,
): AuthoringResult<never> {
  return authoringFailure('missing-asset', 'resources', message, [], source);
}

/**
 * Makes the mistake for a payload or digest that can't be read: `invalid-input` at `resources`,
 * "Resource request could not be decoded". The parser's own message is not passed on.
 */
export function unreadableRequestFailure(): AuthoringResult<never> {
  return authoringFailure('invalid-input', 'resources', 'Resource request could not be decoded');
}

/** Makes the mistake for a capability that refused: `missing-asset`, its failure as `source`. */
function capabilityRefusedFailure(source: FailureSource): AuthoringResult<never> {
  return missingAssetFailure('The owning capability rejected this input', source);
}
