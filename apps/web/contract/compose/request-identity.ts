/*
 * The browser's request identity: the actor every browser request names and the Authoring planner
 * each kind of change names. Their fixed text is checked once, at composition, with Authoring's
 * schemas, so every request carries an `ActorId` and a `PlannerId`. Pure. A failure stops startup
 * before anything mounts (`initialization-failed`), since no request could be built.
 */
import { actorId, plannerId } from '@novakai/canvas-authoring';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import type { RequestIdentity } from '../records/request-identity.js';

/**
 * The request identity: the human browser actor, and the `model`, `dsl` and `library` planners
 * the service registers under the same text. Fails with `initialization-failed` when Authoring's
 * schemas reject any of them.
 */
export function requestIdentity(): Result<RequestIdentity> {
  const actor = actorId.safeParse(BROWSER_ACTOR);
  if (!actor.success) return identityRefused();
  const planners = checkedPlanners();
  if (!planners.ok) return planners;
  const identity: RequestIdentity = {
    actor: { id: actor.data, kind: 'human' },
    planners: planners.value,
  };
  return { ok: true, value: identity };
}

/** The actor of every request this browser builds. */
const BROWSER_ACTOR = 'human:browser';

/** Each planner kind's Authoring planner ID. Fails with `initialization-failed`. */
function checkedPlanners(): Result<RequestIdentity['planners']> {
  const model = plannerId.safeParse('model');
  const dsl = plannerId.safeParse('dsl');
  const library = plannerId.safeParse('library');
  if (!model.success || !dsl.success || !library.success) return identityRefused();
  return { ok: true, value: { model: model.data, dsl: dsl.data, library: library.data } };
}

/** The startup failure when Authoring refuses the browser's actor or a planner ID. */
function identityRefused(): Extract<Result<never>, { readonly ok: false }> {
  return failure('initialization-failed', 'The browser request identity was refused by Authoring');
}
