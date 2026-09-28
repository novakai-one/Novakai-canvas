/*
 * How building a render job refuses, as Authoring failure values at `render-resources`:
 * `missing-asset` when an owner rejects a resource or the pinned preset is not a theme, and
 * `invalid-input` when a resource does not fit its Presentation or Layout schema. Pure; Authoring
 * keeps the prior scene when a job cannot be built.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type { AuthoringResult } from '../../contract/records/capability-types.js';
import type { Result } from '../../contract/errors.js';
import { authoringFailure } from '../../contract/errors.js';

/**
 * The owner's result as a job result. Render resources are mandatory owner results: there is no
 * machine-local fallback font or blank image. Fails with `missing-asset` at `render-resources`
 * ("A render resource owner rejected input", the owner's failure kept as source) when the owner
 * refused.
 */
export function fromOwner<T>(result: Result<T, FailureSource>): AuthoringResult<T> {
  if (!result.ok) return resourceRefused('A render resource owner rejected input', result.error);
  return result;
}

/**
 * A render resource refusal: `missing-asset` at `render-resources` with this message, and the
 * owner's failure in `source` when an owner refused.
 */
export function resourceRefused(
  message: string,
  source?: FailureSource,
): AuthoringResult<never> {
  return authoringFailure('missing-asset', 'render-resources', message, [], source);
}

/**
 * A resource that does not fit its Presentation or Layout schema: `invalid-input` at
 * `render-resources` ("Render resources could not be decoded").
 */
export function undecodable(): AuthoringResult<never> {
  return authoringFailure(
    'invalid-input',
    'render-resources',
    'Render resources could not be decoded',
  );
}
