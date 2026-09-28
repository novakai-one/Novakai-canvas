/*
 * The browser's request identity: the actor every browser request names and the Authoring planner
 * each kind of change names. A record only: no behaviour, no I/O. It is checked once at
 * composition (`contract/compose/request-identity.ts`); the request builders and the source
 * editor read it.
 */
import type { Request } from './owners.js';
import type { PlannerId } from '../brands.js';

/** The Authoring planners the browser's change requests name. */
export type PlannerKind = 'model' | 'dsl' | 'library';

/** Who sends the browser's requests, and the planner each kind of change names. */
export interface RequestIdentity {
  readonly actor: Request['actor'];
  readonly planners: Readonly<Record<PlannerKind, PlannerId>>;
}
