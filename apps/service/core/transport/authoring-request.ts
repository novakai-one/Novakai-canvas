import { requestSchema } from '../../contract/schemas.js';
import type { Request } from '../../contract/records/capabilities.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** Authoring owns its request vocabulary; transport translates only the invalid-input result. */
export function readAuthoringRequest(input: unknown): Result<Request> {
  const request = requestSchema.safeParse(input);
  if (!request.success)
    return failure('invalid-input', 'request', 'Expected a complete version 1 Authoring request');
  return { ok: true, value: request.data };
}
