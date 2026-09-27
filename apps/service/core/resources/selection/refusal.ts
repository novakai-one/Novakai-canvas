/*
 * How a selection step refuses: a private typed throw inside the steps, turned into Authoring's
 * typed failure at the selector boundary (select.ts). Pure; a refusal happens before any lease or
 * write exists, and Authoring owns recovery.
 */
import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import type { AuthoringResult } from '../../../contract/records/capabilities.js';
import { authoringFailure } from '../../../contract/errors.js';

/** A refusal raised inside a selection step; the public boundary turns it into a typed failure. */
export class ResourceFault extends Error {
  /** Input refusals carry no source; owner refusals keep the owner's own failure. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}

/**
 * Runs one selection and returns any refusal as Authoring's typed failure, before a lease or write
 * exists. Fails with `missing-asset` at `resources` for a ResourceFault (the owner's failure kept
 * in `source`), or `invalid-input` at `resources` for any other throw (an undecodable payload).
 */
export function guarded<T>(operation: () => T): AuthoringResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return rejected(error);
  }
}

/**
 * Returns the owner's value. Throws ResourceFault with the owner's failure in `source` when the
 * owner refuses. Nothing missing is replaced by a default.
 */
export function accepted<T>(result: AuthoringResult<T, FailureSource>): T {
  if (!result.ok)
    throw new ResourceFault('The owning capability rejected this input', result.error);
  return result.value;
}

/** A selection refusal asks for a resource fix; any other throw is a decode failure and leaks no native message. */
function rejected(error: unknown): AuthoringResult<never> {
  if (error instanceof ResourceFault)
    return authoringFailure('missing-asset', 'resources', error.message, [], error.source);
  return authoringFailure('invalid-input', 'resources', 'Resource request could not be decoded');
}
