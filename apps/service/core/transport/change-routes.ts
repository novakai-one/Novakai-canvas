/*
 * Why this file exists
 *
 * The browser and the CLI change a diagram in two steps: preview the change, then apply it. For
 * example, `pnpm canvas preview` posts to `/api/v1/authoring/preview`, and `pnpm canvas apply`
 * posts to `/api/v1/authoring/apply`.
 *
 * This file is those two routes. Each reads the change body with the body reader it is given
 * (change-body.ts), then passes the change to the workspace session. It never saves anything
 * itself; Authoring decides whether a change is saved.
 */
import type {
  AdmittedChange,
  ApiCall,
  RouteKey,
} from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { ChangeBodyReader, HttpAdmission } from '../../contract/ports/transport.js';
import type { WorkspaceSession } from '../../contract/types.js';
import type { Generation } from '../../contract/brands.js';
import { jsonRoute, type RouteHandler } from './route-answer.js';

/** A change route, as `METHOD path`: every route under `/api/v1/authoring/`. */
export type ChangeRouteKey = Extract<RouteKey, `POST /api/v1/authoring/${string}`>;

/**
 * What the change routes call: the workspace session and the body reader. `generation` and
 * `admission` are handed to the body reader, which checks the body against them.
 */
export interface ChangeRouteDependencies {
  readonly session: Pick<WorkspaceSession, 'prepare' | 'apply'>;
  readonly generation: Generation;
  readonly admission: Pick<HttpAdmission, 'admitChange'>;
  readonly bodyReader: ChangeBodyReader;
}

/** The Authoring step a mutation route runs: `prepare` previews or plans, `apply` commits. */
type MutationRoute = 'prepare' | 'apply';

/**
 * Builds the two change routes; both answer JSON. `preview` calls the session's `prepare`, which
 * works out what the change would do without saving it; `apply` calls `apply`, which saves it. A
 * body the reader refuses is sent back as that mistake; Authoring's answers pass through.
 */
export function changeRoutes(
  dependencies: ChangeRouteDependencies,
): Readonly<Record<ChangeRouteKey, RouteHandler>> {
  return Object.freeze({
    'POST /api/v1/authoring/preview': jsonRoute((call) =>
      runMutation(call, dependencies, 'prepare'),
    ),
    'POST /api/v1/authoring/apply': jsonRoute((call) => runMutation(call, dependencies, 'apply')),
  });
}

/**
 * Decodes the mutation envelope, then runs the route's step on it. Fails as the body reader:
 * `invalid-input` at `content-type`, `body` or `request`, `conflict` at `generation`,
 * `unauthorized` at `actor` or `intent.planner`.
 */
async function runMutation(
  call: ApiCall,
  dependencies: ChangeRouteDependencies,
  route: MutationRoute,
): Promise<HttpOutcome> {
  const mutation = dependencies.bodyReader.read(call.body, {
    caller: call.caller,
    metadata: call.metadata,
    generation: dependencies.generation,
    admission: dependencies.admission,
  });
  if (!mutation.ok) return mutation;
  return MUTATION_STEPS[route](mutation.value, call.signal, dependencies.session);
}

/** Runs one Authoring step on an admitted mutation. */
type MutationStep = (
  mutation: AdmittedChange,
  signal: AbortSignal,
  session: ChangeRouteDependencies['session'],
) => Promise<HttpOutcome>;

/**
 * The session call of each step. `prepare` passes the envelope's prepare mode; `apply` its
 * options. Authoring outcomes pass through.
 */
const MUTATION_STEPS: Readonly<Record<MutationRoute, MutationStep>> = Object.freeze({
  prepare: (mutation, signal, session) => session.prepare(mutation.request, signal, mutation.mode),
  apply: (mutation, signal, session) => session.apply(mutation.request, signal, mutation.options),
});
