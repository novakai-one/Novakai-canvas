/*
 * What every planner role shares: the change-intent guard, the proposal check against
 * Authoring's schema, and the failure that keeps an owner's refusal as its source. Pure; each
 * helper answers an Authoring failure value and never throws. Authoring owns scope, commit and
 * retry.
 */
import type {
  AuthoringDiagnostic,
  AuthoringErrorCode,
  AuthoringResult,
  Json,
  Proposal,
  Request,
} from '../../../contract/records/capabilities.js';
import { proposalSchema } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';

/** The codes a planner answers when an owning capability refuses its input. */
export type OwnerRefusalCode = Extract<AuthoringErrorCode, 'invalid-input' | 'invariant-violation'>;

/** An owning capability's own failure, kept unchanged as the diagnostic's source. */
export type OwnerFailure = NonNullable<AuthoringDiagnostic['source']>;

/**
 * The request's change payload. Fails with `invalid-input` at `path` with `message` for an undo
 * or redo; Authoring runs those itself, so no planner reads them.
 */
export function changePayload(
  request: Request,
  path: string,
  message: string,
): AuthoringResult<Json> {
  if (request.intent.kind !== 'change') return authoringFailure('invalid-input', path, message);
  return { ok: true, value: request.intent.payload };
}

/**
 * Checks a planned proposal against Authoring's schema. Fails with `invalid-input` at `path` with
 * `message` when it exceeds Authoring's limits.
 */
export function checkedProposal(
  input: unknown,
  path: string,
  message: string,
): AuthoringResult<Proposal> {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return authoringFailure('invalid-input', path, message);
  return { ok: true, value: parsed.data };
}

/**
 * The failure for an owning capability's refusal: `code` at `path`, the fixed message "The owning
 * capability rejected this input", and the owner's failure kept as source. Never throws.
 */
export function ownerRejected<T>(
  code: OwnerRefusalCode,
  path: string,
  source: OwnerFailure,
): AuthoringResult<T> {
  return authoringFailure(code, path, 'The owning capability rejected this input', [], source);
}
