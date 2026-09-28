import type { IntentPlanner } from '../../contract/ports/planning.js';
import type { Request } from '../../contract/records/request.js';
import type { Json, Snapshot } from '../../contract/records/storage.js';
import type { Proposal } from '../../contract/records/proposal.js';
import type { Result } from '../../contract/errors.js';
import { plannerId } from '../../contract/brands.js';
import { failure } from '../../contract/errors.js';
import { accepted, reject } from '../validation/outcomes.js';
import { planInverse } from '../history/inverse.js';

/**
 * Checks the registered planners once, when Authoring is composed.
 *
 * This returns a failed result instead of throwing, so an invalid set of planners gives a
 * facade that reports the failure on every call.
 *
 * @param planners - The planners to register.
 * @returns A successful result, or `invalid-input` at `planners` when an ID is malformed or repeats.
 */
export function validateRegistry(planners: readonly IntentPlanner[]): Result<void> {
  const hasMalformedId = planners.some((planner) => !plannerId.safeParse(planner.id).success);
  if (hasMalformedId) return failure('invalid-input', 'planners', 'Malformed planner identity');

  const distinctIds = new Set(planners.map((planner) => planner.id));
  if (distinctIds.size !== planners.length)
    return failure('invalid-input', 'planners', 'Duplicate planner registration');

  return { ok: true, value: undefined };
}

/**
 * Plans the writes for a request's intent.
 *
 * - A `change` intent goes to the registered planner it names.
 * - An `undo` or `redo` intent is planned by Authoring from its own history.
 *
 * Planning only proposes writes. Every admission check still runs on the proposal afterwards.
 *
 * @param request - The checked submitted request.
 * @param snapshot - The current workspace snapshot.
 * @param pins - The resource pins resolved for this request.
 * @param planners - The registered planners.
 * @returns The proposed writes.
 * @throws AuthoringFault `invalid-input` when the named planner is not registered.
 * @throws AuthoringFault with the planner's own diagnostic when planning fails.
 * @throws AuthoringFault from undo/redo planning when there is nothing valid to undo or redo.
 */
export async function planIntent(
  request: Request,
  snapshot: Snapshot,
  pins: Json,
  planners: readonly IntentPlanner[],
): Promise<Proposal> {
  switch (request.intent.kind) {
    case 'change':
      return planChange(request, snapshot, pins, planners);
    case 'undo':
    case 'redo':
      return planInverseAsync(request, snapshot);
    default:
      return unsupportedIntent(request.intent);
  }
}

/**
 * Plans an undo or redo inside an async function. This keeps the scheduling of the original async
 * undo/redo handler; it does not make it settle on the same schedule as a change planner.
 */
async function planInverseAsync(
  request: Request,
  snapshot: Snapshot,
): Promise<Proposal> {
  return planInverse(request, snapshot);
}

/** Sends a change intent to the registered planner it names. */
async function planChange(
  request: Request,
  snapshot: Snapshot,
  pins: Json,
  planners: readonly IntentPlanner[],
): Promise<Proposal> {
  const intent = request.intent;
  if (intent.kind !== 'change')
    return reject('invalid-input', 'intent', 'Change planner requires a change intent');

  const planner = planners.find((candidate) => candidate.id === intent.planner);
  if (planner === undefined)
    return reject('invalid-input', 'planner', 'Intent planner is not registered');

  return accepted(await planner.plan(request, snapshot, pins));
}

/**
 * Rejects an intent kind that the request schema does not allow.
 * Typed `never`, so adding a new intent kind fails to compile until `planIntent` handles it.
 */
function unsupportedIntent(intent: never): never {
  void intent;
  return reject('invalid-input', 'intent', 'Unsupported intent kind');
}
