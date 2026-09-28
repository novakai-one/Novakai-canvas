/*
 * How a selection step refuses, as Authoring failure values: `missing-asset` at `resources` for a
 * resource refusal (an owner's failure kept in `source`), `invalid-input` at `resources` for a
 * payload that does not decode. Pure; a refusal happens before any lease or write exists, and
 * Authoring owns recovery.
 */
import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import type { AuthoringResult } from '../../../contract/records/capabilities.js';
import { authoringFailure } from '../../../contract/errors.js';

/**
 * The owner's result as a selection result. Fails with `missing-asset` at `resources` ("The
 * owning capability rejected this input", the owner's failure kept in `source`) when the owner
 * refused. Nothing missing is replaced by a default.
 */
export function fromOwner<T>(result: AuthoringResult<T, FailureSource>): AuthoringResult<T> {
  if (!result.ok) return resourceRefused('The owning capability rejected this input', result.error);
  return result;
}

/**
 * A resource refusal: `missing-asset` at `resources` with this message, and the owner's failure
 * in `source` when an owner refused.
 */
export function resourceRefused(
  message: string,
  source?: FailureSource,
): AuthoringResult<never> {
  return authoringFailure('missing-asset', 'resources', message, [], source);
}

/**
 * A payload or digest that does not decode: `invalid-input` at `resources` ("Resource request
 * could not be decoded"). No native parser message leaks.
 */
export function undecodable(): AuthoringResult<never> {
  return authoringFailure('invalid-input', 'resources', 'Resource request could not be decoded');
}
