/*
 * Why this file exists
 *
 * A source that names `./assets/logo.png` needs the logo's bytes stored in the service before the
 * change is sent. That, and preparing a theme or recipe to save, are calls to
 * `POST /api/v1/resources/<step>`, such as `/api/v1/resources/stage`.
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

/** Checks one answer's value. */
type Check<T> = (value: unknown) => Result<T>;

/**
 * Gives core its font, image, theme and recipe steps, made over `transport`. Each fails as the
 * transport does, or with `invalid-response` when the answer isn't the expected shape
 * (`invalid-input` for `freeze`).
 */
export function createServiceResources(transport: TransportPost): ServiceResources {
  return {
    stage: (input) => call(transport, 'stage', input, stagedDigest),
    blob: (digest) => call(transport, 'blob', digest, blobBackup),
    freeze: (request, assets) => call(transport, 'freeze', { ...request, assets }, frozenRequest),
    restore: (backup) => call(transport, 'restore', backup, restored),
    prepare: (admission, assets) => call(transport, 'prepare', { admission, assets }, preparation),
    instantiate: (expansion) => call(transport, 'instantiate', expansion, expandedSource),
  };
}

/**
 * Posts `body` to one resource route and checks the answer's value. Fails as the transport or
 * `check` does.
 */
async function call<T>(
  transport: TransportPost,
  action: ResourceAction,
  body: unknown,
  check: Check<T>,
): Promise<Result<T>> {
  const answer = await transport.post(`/api/v1/resources/${action}`, body);
  if (!answer.ok) return answer;
  return check(answer.value.value);
}

/** The digest of the bytes Assets admitted. Fails with `invalid-response`. */
function stagedDigest(value: unknown): Result<AssetDigest> {
  const parsed = stagedAnswerSchema.safeParse(value);
  if (!parsed.success) return invalidResponse('Invalid Assets admission');
  return success(parsed.data.descriptor.digest);
}

/**
 * The normalised bytes and their digest, as the journal keeps them. Fails with `invalid-response`
 * (bad answer, or bad digest).
 */
function blobBackup(value: unknown): Result<ByteBackup> {
  const parsed = blobAnswerSchema.safeParse(value);
  if (!parsed.success) return invalidResponse('Invalid normalized Assets bytes');
  const checked = byteBackupSchema.safeParse({
    digest: parsed.data.descriptor.digest,
    base64: parsed.data.base64,
  });
  if (!checked.success) return invalidResponse('Invalid normalized Assets digest');
  return success(checked.data);
}

/** The frozen request, checked by Authoring's request schema. Fails with `invalid-input`. */
function frozenRequest(value: unknown): Result<AuthoringRequest> {
  const checked = requestSchema.safeParse(value);
  if (!checked.success) return invalidInputFailure();
  return success(checked.data);
}

/** A restore answers nothing the CLI reads. Never fails. */
function restored(): Result<void> {
  return success(undefined);
}

/**
 * The preset key; the whole answer, checked as JSON, is kept unchanged as the change payload.
 * Fails with `invalid-response`.
 */
function preparation(value: unknown): Result<PresetPreparation> {
  const parsed = preparedAnswerSchema.safeParse(value);
  const document = presetDocumentSchema.safeParse(value);
  if (!parsed.success || !document.success)
    return invalidResponse('Service returned invalid preset preparation');
  return success({ key: parsed.data.key, document: document.data });
}

/**
 * Recipe expansion is editable DSL text, never structured authoring input. Fails with
 * `invalid-response`.
 */
function expandedSource(value: unknown): Result<string> {
  if (typeof value !== 'string')
    return invalidResponse('Recipe expansion did not return editable DSL');
  return success(value);
}

/** An answer that does not match its schema: always `invalid-response`. */
function invalidResponse(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-response', message });
}
