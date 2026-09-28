/*
 * Why this file exists
 *
 * Knowing who is calling is not enough to let a change through. For example, the CLI could send a
 * change that says the browser wrote it, or one made with a planner only the browser may use.
 *
 * This file checks a change request: it must be a complete Authoring request, its author must be
 * the caller, and it must use a planner the caller may use. It never runs the change.
 */
import type { Caller } from '../../contract/records/transport/http.js';
import type { Request } from '../../contract/records/capability-types.js';
import type { PlannerId } from '../../contract/brands.js';
import { plannerId, requestSchema } from '../../contract/schemas.js';
import { failure, success, type Result } from '../../contract/errors.js';

/**
 * The planners each caller may use: `human` is the browser, `agent` is the CLI. Installation is
 * never offered, and the CLI never gets the raw Model planner, whatever the request says.
 */
const PLANNERS: Readonly<Record<Caller['kind'], readonly PlannerId[]>> = Object.freeze({
  human: plannerIds('dsl', 'model', 'library'),
  agent: plannerIds('dsl', 'library', 'preset'),
});

/**
 * Checks that the input is an Authoring request this caller may send, and gives it back checked.
 * Its author must be the caller, and a change must use a planner the caller may use; undo and redo
 * name no planner. Fails with `invalid-input` at `request`, or `unauthorized` at `actor` or
 * `intent.planner`.
 */
export function admitChange(
  input: unknown,
  caller: Caller,
): Result<Request> {
  const request = readRequest(input);
  if (!request.ok) {
    return request;
  }
  return checkCallerMaySend(request.value, caller);
}

/** Reads the input with Authoring's request schema. */
function readRequest(input: unknown): Result<Request> {
  const request = requestSchema.safeParse(input);
  if (!request.success) {
    return malformedRequestFailure();
  }
  return success(request.data);
}

/** Checks the request's author is the caller, and that it uses a planner the caller may use. */
function checkCallerMaySend(
  request: Request,
  caller: Caller,
): Result<Request> {
  if (!isSentByCaller(request, caller)) {
    return actorMismatchFailure();
  }
  if (!mayUsePlanner(request, caller)) {
    return plannerNotAllowedFailure();
  }
  return success(request);
}

/** Whether the request's actor is exactly the authenticated caller. */
function isSentByCaller(
  request: Request,
  caller: Caller,
): boolean {
  const sameId = request.actor.id === caller.id;
  return sameId && request.actor.kind === caller.kind;
}

/**
 * Whether the request is an undo or a redo (they name no planner), or a change through one of the
 * caller's planners.
 */
function mayUsePlanner(
  request: Request,
  caller: Caller,
): boolean {
  if (request.intent.kind !== 'change') {
    return true;
  }
  return PLANNERS[caller.kind].includes(request.intent.planner);
}

/**
 * Brands a fixed list of planner ids with Authoring's `plannerId` and freezes it. Runs once at
 * module load on the literals above, which are all valid ids.
 */
function plannerIds(...ids: readonly string[]): readonly PlannerId[] {
  const planners = ids.map((id) => plannerId.parse(id));
  return Object.freeze(planners);
}

/** Makes the mistake for input that isn't a complete Authoring request. */
function malformedRequestFailure(): Result<never> {
  return failure('invalid-input', 'request', 'Expected a complete version 1 Authoring request');
}

/** Makes the mistake for a request whose actor isn't the authenticated caller. */
function actorMismatchFailure(): Result<never> {
  return failure('unauthorized', 'actor', 'Submitted actor must match the authenticated caller');
}

/** Makes the mistake for a change through a planner the caller may not use. */
function plannerNotAllowedFailure(): Result<never> {
  return failure(
    'unauthorized',
    'intent.planner',
    'This planner is not available to the authenticated caller',
  );
}
