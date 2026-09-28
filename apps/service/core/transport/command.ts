/*
 * Decodes a mutation body into an admitted Authoring request. Pure; malformed input never reaches
 * Authoring. A changed generation never grants an automatic retry: the caller rereads and
 * reconciles its original receipt first. Authoring owns commit and receipt recovery.
 */
import type { AdmittedMutation } from '../../contract/records/transport/protocol.js';
import type { CommandAdmission } from '../../contract/ports/transport.js';
import type { PrepareMode } from '../../contract/records/workspace/session.js';
import { mutationEnvelope } from '../../contract/records/transport/protocol.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { jsonBody } from './json-body.js';

/** A body that passed the version 1 envelope schema. */
type MutationEnvelope = ReturnType<typeof mutationEnvelope.parse>;

/**
 * The body as an admitted mutation. Fails with `invalid-input` at `content-type` or `body` as
 * `jsonBody` (json-body.ts); otherwise as `admitEnvelope`.
 */
export function readCommand(
  body: string,
  context: CommandAdmission,
): Result<AdmittedMutation> {
  const decoded = jsonBody(body, context.metadata.contentType, 'mutation');
  if (!decoded.ok) return decoded;
  return admitEnvelope(decoded.value, context);
}

/**
 * Fails with `invalid-input` at `body` unless the value is a version 1 mutation envelope;
 * otherwise as `admitCurrent`.
 */
function admitEnvelope(
  input: unknown,
  context: CommandAdmission,
): Result<AdmittedMutation> {
  const parsed = mutationEnvelope.safeParse(input);
  if (!parsed.success)
    return failure('invalid-input', 'body', 'Expected a version 1 mutation envelope');
  return admitCurrent(parsed.data, context);
}

/**
 * Fails with `conflict` at `generation` when the envelope names another transport generation;
 * otherwise as the ingress admission: `invalid-input` at `request`, `unauthorized` at `actor` or
 * `intent.planner`. The envelope's `preview` flag becomes the prepare mode.
 */
function admitCurrent(
  envelope: MutationEnvelope,
  context: CommandAdmission,
): Result<AdmittedMutation> {
  if (envelope.generation !== context.generation)
    return failure(
      'conflict',
      'generation',
      'Workspace session changed; reconcile the request receipt',
    );
  const request = context.admission.admitMutation(envelope.request, context.caller);
  if (!request.ok) return request;
  return success({
    request: request.value,
    mode: prepareMode(envelope),
    options: envelope.options,
  });
}

/** `with-preview` when the envelope asks for preview images, `without-preview` otherwise. */
function prepareMode(envelope: MutationEnvelope): PrepareMode {
  if (envelope.preview) return 'with-preview';
  return 'without-preview';
}
