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
import type { Generation } from '../../contract/brands.js';
import { changeRequestBody } from '../../contract/records/transport/protocol.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { readJsonBody } from './json-body.js';

/** A body that passed the version 1 change envelope schema. */
type ChangeEnvelope = ReturnType<typeof changeRequestBody.parse>;

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
  const json = readJsonBody(body, context.metadata.contentType, 'change');
  if (!json.ok) {
    return json;
  }
  const envelope = readCurrentEnvelope(json.value, context.generation);
  if (!envelope.ok) {
    return envelope;
  }
  return admitEnvelope(envelope.value, context);
}

/** Checks the JSON is a version 1 change envelope made for this server run. */
function readCurrentEnvelope(
  json: unknown,
  generation: Generation,
): Result<ChangeEnvelope> {
  const envelope = changeRequestBody.safeParse(json);
  if (!envelope.success) {
    return malformedEnvelopeFailure();
  }
  if (envelope.data.generation !== generation) {
    return otherServerRunFailure();
  }
  return success(envelope.data);
}

/** Checks the caller may send the envelope's request, then gives back the change to run. */
function admitEnvelope(
  envelope: ChangeEnvelope,
  context: BodyCheckContext,
): Result<AdmittedChange> {
  const request = context.admission.admitChange(envelope.request, context.caller);
  if (!request.ok) {
    return request;
  }
  const change: AdmittedChange = {
    request: request.value,
    mode: prepareMode(envelope),
    options: envelope.options,
  };
  return success(change);
}

/** Chooses `with-preview` when the envelope asks for preview images, `without-preview` otherwise. */
function prepareMode(envelope: ChangeEnvelope): PrepareMode {
  if (envelope.preview) {
    return 'with-preview';
  }
  return 'without-preview';
}

/** Makes the mistake for JSON that isn't a version 1 change envelope. */
function malformedEnvelopeFailure(): Result<never> {
  return failure('invalid-input', 'body', 'Expected a version 1 mutation envelope');
}

/** Makes the mistake for a body made for another server run, such as one sent before a restart. */
function otherServerRunFailure(): Result<never> {
  return failure(
    'conflict',
    'generation',
    'Workspace session changed; reconcile the request receipt',
  );
}
