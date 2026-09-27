/*
 * Reads an untrusted mutation request with Authoring's own request schema. Pure. Authoring owns
 * the request vocabulary; transport only translates a refusal. The caller corrects the request
 * and resends it.
 */
import type { Request } from '../../contract/records/capabilities.js';
import { requestSchema } from '../../contract/schemas.js';
import { failure, success, type Result } from '../../contract/errors.js';

/**
 * The input as an Authoring request. Fails with `invalid-input` at `request` when Authoring's
 * schema refuses it.
 */
export function readAuthoringRequest(input: unknown): Result<Request> {
  const request = requestSchema.safeParse(input);
  if (!request.success)
    return failure('invalid-input', 'request', 'Expected a complete version 1 Authoring request');
  return success(request.data);
}
