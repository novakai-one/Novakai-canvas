import { mutationEnvelope } from '../../contract/records/transport/protocol.js';
import type {
  AdmittedMutation,
  CommandAdmission,
} from '../../contract/records/transport/protocol.js';
import { httpBodyLimit } from '../../contract/records/transport/http.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** Decode only bounded JSON with the advertised content type; malformed input never reaches Authoring. */
function envelope(
  body: string,
  contentType: string,
): Result<unknown> {
  if (contentType.split(';')[0]?.trim() !== 'application/json')
    return failure('invalid-input', 'content-type', 'Use application/json for a mutation');
  return boundedJson(body);
}
/** TextEncoder uses the same UTF-8 byte budget as the socket reader, including non-ASCII source text. */
function boundedJson(body: string): Result<unknown> {
  if (new TextEncoder().encode(body).byteLength > httpBodyLimit)
    return failure('invalid-input', 'body', 'Request exceeds the 24 MiB transport limit');
  try {
    const value: unknown = JSON.parse(body);
    return { ok: true, value };
  } catch {
    return failure('invalid-input', 'body', 'Request body must be valid JSON');
  }
}
/** Require generation before owner schema admission; a retained request needs receipt reconciliation after restart. */
function admitEnvelope(
  input: unknown,
  context: CommandAdmission,
): Result<AdmittedMutation> {
  const parsed = mutationEnvelope.safeParse(input);
  if (!parsed.success)
    return failure('invalid-input', 'body', 'Expected a version 1 mutation envelope');
  return admitCurrent(parsed.data, context);
}
/** A changed generation never grants an automatic retry; callers reread and reconcile the original receipt first. */
function admitCurrent(
  input: ReturnType<typeof mutationEnvelope.parse>,
  context: CommandAdmission,
): Result<AdmittedMutation> {
  if (input.generation !== context.generation)
    return failure(
      'conflict',
      'generation',
      'Workspace session changed; reconcile the request receipt',
    );
  const request = context.ingress.mutation(input.request, context.caller);
  if (!request.ok) return request;
  return {
    ok: true,
    value: { request: request.value, preview: input.preview, options: input.options },
  };
}
/** The HTTP adapter authenticates before reading a body. This pure boundary validates payload policy before invoking handlers. */
export function readCommand(
  body: string,
  context: CommandAdmission,
): Result<AdmittedMutation> {
  const decoded = envelope(body, context.metadata.contentType);
  if (!decoded.ok) return decoded;
  return admitEnvelope(decoded.value, context);
}
