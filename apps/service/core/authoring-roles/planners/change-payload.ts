/*
 * Why this file exists
 *
 * Every planner first takes the change out of the request, and last checks its planned writes fit
 * Authoring's limits. When Model, Library or Language refuses a change, the planner must say so
 * and keep their reason. For example, a DSL change with a typo is refused with `invalid-input` at
 * `source`, and Language's own mistake rides along as its `source`.
 *
 * This file holds those three shared steps, so every planner does them the same way. Each answers
 * Authoring's `Result` (contract/errors.ts). It never plans or saves anything itself.
 */
import type {
  AuthoringDiagnostic,
  AuthoringErrorCode,
  AuthoringResult,
  Json,
  Proposal,
  Request,
} from '../../../contract/records/capability-types.js';
import { proposalSchema } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';

/** The codes a planner answers when Model, Library or Language refuses a change. */
export type CapabilityRefusalCode = Extract<
  AuthoringErrorCode,
  'invalid-input' | 'invariant-violation'
>;

/** A capability's own mistake (for example Language's), kept unchanged as the `source`. */
export type CapabilityFailure = NonNullable<AuthoringDiagnostic['source']>;

/**
 * Takes the change out of a request: the payload its planner reads, as unchecked JSON.
 * An undo or redo is refused with `invalid-input` at `path`, saying `message`, because Authoring
 * runs those itself. Each planner picks its own `path` and `message`.
 */
export function readChangePayload(
  request: Request,
  path: string,
  message: string,
): AuthoringResult<Json> {
  if (request.intent.kind !== 'change') return authoringFailure('invalid-input', path, message);
  return { ok: true, value: request.intent.payload };
}

/**
 * Checks a planner's writes fit Authoring's proposal shape and limits, and answers the `Proposal`.
 * `planned` is the planner's own object, not yet checked. When it doesn't fit, the mistake is
 * `invalid-input` at `path`, saying `message`.
 */
export function checkProposal(
  planned: unknown,
  path: string,
  message: string,
): AuthoringResult<Proposal> {
  const parsed = proposalSchema.safeParse(planned);
  if (!parsed.success) return authoringFailure('invalid-input', path, message);
  return { ok: true, value: parsed.data };
}

/**
 * Makes the mistake a planner answers when Model, Library or Language refuses a change: `code` at
 * `path`, saying "The owning capability rejected this input", with the capability's own mistake
 * kept as `source`.
 */
export function capabilityRefusalFailure<T>(
  code: CapabilityRefusalCode,
  path: string,
  source: CapabilityFailure,
): AuthoringResult<T> {
  return authoringFailure(code, path, 'The owning capability rejected this input', [], source);
}
