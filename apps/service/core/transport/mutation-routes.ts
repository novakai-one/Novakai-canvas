/*
 * The two Authoring mutation routes: `POST /api/v1/authoring/preview` prepares (previews or plans)
 * a request and `POST /api/v1/authoring/apply` commits it. Pure over the injected owners; no route
 * writes storage. A stale generation is the caller's to reconcile; Authoring owns commit and
 * receipt recovery. A throw reaches the HTTP server's `receive` (routes.ts).
 */
import type {
  AdmittedMutation,
  ApiCall,
  RouteKey,
} from '../../contract/records/transport/protocol.js';
import type { WireOutcome } from '../../contract/records/transport/wire-codes.js';
import type { CommandDecoder, HttpAdmission } from '../../contract/ports/transport.js';
import type { WorkspaceSession } from '../../contract/types.js';
import type { Generation } from '../../contract/brands.js';
import { answerJson, type RouteHandler } from './route-answer.js';

/** A mutation route, as `METHOD path`: every route under `/api/v1/authoring/`. */
export type MutationRouteKey = Extract<RouteKey, `POST /api/v1/authoring/${string}`>;

/** The owners the mutation routes forward to. `generation` is the current transport generation. */
export interface MutationRouteOwners {
  readonly session: Pick<WorkspaceSession, 'prepare' | 'apply'>;
  readonly generation: Generation;
  readonly admission: Pick<HttpAdmission, 'mutation'>;
  readonly decoder: CommandDecoder;
}

/** The Authoring step a mutation route runs: `prepare` previews or plans, `apply` commits. */
type MutationRoute = 'prepare' | 'apply';

/**
 * The frozen mutation route table; both answer JSON. Both routes fail as `runMutation`; Authoring
 * outcomes pass through.
 */
export function mutationRoutes(
  owners: MutationRouteOwners,
): Readonly<Record<MutationRouteKey, RouteHandler>> {
  return Object.freeze({
    'POST /api/v1/authoring/preview': answerJson((call) => runMutation(call, owners, 'prepare')),
    'POST /api/v1/authoring/apply': answerJson((call) => runMutation(call, owners, 'apply')),
  });
}

/**
 * Decodes the mutation envelope, then runs the route's step on it. Fails as the decoder:
 * `invalid-input` at `content-type`, `body` or `request`, `conflict` at `generation`,
 * `unauthorized` at `actor` or `intent.planner`.
 */
async function runMutation(
  call: ApiCall,
  owners: MutationRouteOwners,
  route: MutationRoute,
): Promise<WireOutcome> {
  const mutation = owners.decoder.read(call.body, {
    caller: call.caller,
    metadata: call.metadata,
    generation: owners.generation,
    ingress: owners.admission,
  });
  if (!mutation.ok) return mutation;
  return MUTATION_STEPS[route](mutation.value, call.signal, owners.session);
}

/** Runs one Authoring step on an admitted mutation. */
type MutationStep = (
  mutation: AdmittedMutation,
  signal: AbortSignal,
  session: MutationRouteOwners['session'],
) => Promise<WireOutcome>;

/**
 * The session call of each step. `prepare` passes the envelope's prepare mode; `apply` its
 * options. Authoring outcomes pass through.
 */
const MUTATION_STEPS: Readonly<Record<MutationRoute, MutationStep>> = Object.freeze({
  prepare: (mutation, signal, session) => session.prepare(mutation.request, signal, mutation.mode),
  apply: (mutation, signal, session) => session.apply(mutation.request, signal, mutation.options),
});
