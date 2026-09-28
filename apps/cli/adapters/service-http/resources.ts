/*
 * Why this file exists
 *
 * A source that names `./assets/logo.png` needs the logo's bytes stored in the service before the
 * change is sent. Then `freeze` has the service write each stored file's digest (a fingerprint of
 * its bytes) into the request, so the change points at exactly those bytes. Each step, and
 * preparing a theme or recipe to save, is a call to `POST /api/v1/resources/<step>`.
 *
 * This file makes those calls and checks each answer. None saves a change: bytes stored by a
 * command that then fails are simply left unused, and the command can be run again.
 */
import type { HttpTransport, ResourceAction } from '../../contract/ports/http-transport.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { AuthoringRequest } from '../../contract/records/foreign.js';
import type { ByteBackup } from '../../contract/records/retained-request.js';
import { byteBackupSchema } from '../../contract/records/retained-request.js';
import type { PresetPreparation } from '../../contract/records/service-answers.js';
import {
  blobAnswerSchema,
  preparedAnswerSchema,
  presetDocumentSchema,
  stagedAnswerSchema,
} from '../../contract/records/service-answers.js';
import { requestSchema } from '../../contract/schemas.js';
import type { AssetDigest } from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, invalidInputFailure, success } from '../../contract/errors.js';

/** The transport's POST; this adapter never sends a GET. */
type TransportPost = Pick<HttpTransport, 'post'>;

/** Checks what one resource step answered, and gives what the CLI needs from it. */
type AnswerCheck<T> = (answered: unknown) => Result<T>;

/**
 * Gives core its font, image, theme and recipe calls, made over `transport`. Each fails as the
 * transport does, or with `invalid-response` when the answer isn't the expected shape. The one
 * exception: when the request `freeze` gives back fails Authoring's check, it is `invalid-input`.
 */
export function createServiceResources(transport: TransportPost): ServiceResources {
  return {
    stage: (input) => postResourceStep(transport, 'stage', input, checkStagedDigest),
    blob: (digest) => postResourceStep(transport, 'blob', digest, checkByteBackup),
    freeze: (request, assets) =>
      postResourceStep(transport, 'freeze', { ...request, assets }, checkFrozenRequest),
    restore: (backup) => postResourceStep(transport, 'restore', backup, acceptAnyAnswer),
    prepare: (admission, assets) =>
      postResourceStep(transport, 'prepare', { admission, assets }, checkPresetPreparation),
    instantiate: (expansion) =>
      postResourceStep(transport, 'instantiate', expansion, checkExpandedSource),
  };
}

/** Posts `body` to one resource step's route, then checks what it answered with `check`. */
async function postResourceStep<T>(
  transport: TransportPost,
  action: ResourceAction,
  body: unknown,
  check: AnswerCheck<T>,
): Promise<Result<T>> {
  const answer = await transport.post(`/api/v1/resources/${action}`, body);
  if (!answer.ok) {
    return answer;
  }
  return check(answer.value.value);
}

/** Checks the stage answer, and gives the digest Assets stored the bytes under. */
function checkStagedDigest(answered: unknown): Result<AssetDigest> {
  const staged = stagedAnswerSchema.safeParse(answered);
  if (!staged.success) {
    return invalidResponseFailure('Invalid Assets admission');
  }
  return success(staged.data.descriptor.digest);
}

/** Checks the blob answer, and gives the stored bytes and digest as the journal keeps them. */
function checkByteBackup(answered: unknown): Result<ByteBackup> {
  const blob = blobAnswerSchema.safeParse(answered);
  if (!blob.success) {
    return invalidResponseFailure('Invalid normalized Assets bytes');
  }
  const backup = byteBackupSchema.safeParse({
    digest: blob.data.descriptor.digest,
    base64: blob.data.base64,
  });
  if (!backup.success) {
    return invalidResponseFailure('Invalid normalized Assets digest');
  }
  return success(backup.data);
}

/** Checks the frozen request with Authoring's own request check. */
function checkFrozenRequest(answered: unknown): Result<AuthoringRequest> {
  const frozen = requestSchema.safeParse(answered);
  if (!frozen.success) {
    return invalidInputFailure();
  }
  return success(frozen.data);
}

/** Accepts any restore answer: the CLI reads nothing from it. */
function acceptAnyAnswer(): Result<void> {
  return success(undefined);
}

/** Checks the prepare answer, and gives the preset key, with the whole answer as its document. */
function checkPresetPreparation(answered: unknown): Result<PresetPreparation> {
  const prepared = preparedAnswerSchema.safeParse(answered);
  const presetDocument = presetDocumentSchema.safeParse(answered);
  if (!prepared.success || !presetDocument.success) {
    return invalidResponseFailure('Service returned invalid preset preparation');
  }
  return success({ key: prepared.data.key, document: presetDocument.data });
}

/** Checks the recipe expansion is DSL text the agent can edit. */
function checkExpandedSource(answered: unknown): Result<string> {
  if (typeof answered !== 'string') {
    return invalidResponseFailure('Recipe expansion did not return editable DSL');
  }
  return success(answered);
}

/** Makes the mistake for an answer that isn't the expected shape (`invalid-response`). */
function invalidResponseFailure(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-response', message });
}
