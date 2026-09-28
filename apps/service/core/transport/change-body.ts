/*
 * Why this file exists
 *
 * A change reaches the service as a JSON body, and nothing in it can be trusted yet. For example,
 * `{ version: 1, generation, request, preview: true }` must be well formed, carry the `generation`
 * (the label of this server run) it was made for, and hold a request its sender may make.
 *
 * This file checks the body in that order and gives back the change, ready for Authoring (which
 * saves changes) to run. It never runs the change. A body made before a restart is refused
 * (`conflict`); the caller must check whether the change already landed before sending it again.
 */
import type { AdmittedChange } from '../../contract/records/transport/protocol.js';
import type { BodyCheckContext } from '../../contract/ports/transport.js';
import type { PrepareMode } from '../../contract/records/workspace/session.js';
import { changeRequestBody } from '../../contract/records/transport/protocol.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { readJsonBody } from './json-body.js';

/** A body that passed the version 1 envelope schema. */
type MutationEnvelope = ReturnType<typeof changeRequestBody.parse>;

/**
 * Reads the body text, as sent, into a change Authoring may run. `context` is who sent it, the
 * request's headers, this server run's `generation`, and the admission check. Fails with
 * `invalid-input` for a malformed body, `conflict` at `generation` when it was made for another
 * server run, and otherwise as `admitChange` (admission.ts).
 */
export function readChangeBody(
  body: string,
  context: BodyCheckContext,
): Result<AdmittedChange> {
  const decoded = readJsonBody(body, context.metadata.contentType, 'change');
  if (!decoded.ok) return decoded;
  return admitEnvelope(decoded.value, context);
}

/**
 * Fails with `invalid-input` at `body` unless the value is a version 1 mutation envelope;
 * otherwise as `admitCurrent`.
 */
function admitEnvelope(
  input: unknown,
  context: BodyCheckContext,
): Result<AdmittedChange> {
  const parsed = changeRequestBody.safeParse(input);
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
  context: BodyCheckContext,
): Result<AdmittedChange> {
  if (envelope.generation !== context.generation)
    return failure(
      'conflict',
      'generation',
      'Workspace session changed; reconcile the request receipt',
    );
  const request = context.admission.admitChange(envelope.request, context.caller);
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
