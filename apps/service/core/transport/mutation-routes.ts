/*
 * The two Authoring mutation routes: `POST /api/v1/authoring/preview` prepares (previews or plans)
 * a request and `POST /api/v1/authoring/apply` commits it. Pure over the injected owners; no route
 * writes storage. A stale generation is the caller's to reconcile; Authoring owns commit and
 * receipt recovery. A throw reaches the HTTP server's `receive` (routes.ts).
 */
import type {
  AdmittedMutation,
  ApiCall,
  ApiRouter,
  CommandDecoder,
  WireOutcome,
} from '../../contract/records/transport/protocol.js';
import type { HttpAdmission } from '../../contract/records/transport/http.js';
import type { WorkspaceSession } from '../../contract/types.js';

/** A mutation route, as `METHOD path`. */
export type MutationRouteKey = 'POST /api/v1/authoring/preview' | 'POST /api/v1/authoring/apply';

/** The owners the mutation routes forward to. `generation` is the current transport generation. */
export interface MutationRouteOwners {
  readonly session: Pick<WorkspaceSession, 'prepare' | 'apply'>;
  readonly generation: string;
  readonly admission: Pick<HttpAdmission, 'mutation'>;
  readonly decoder: CommandDecoder;
}

/** The Authoring step run on an admitted mutation. */
type MutationStep = (mutation: AdmittedMutation, signal: AbortSignal) => Promise<WireOutcome>;

/**
 * The frozen mutation route table. Both routes fail as `admitted`; Authoring outcomes pass
 * through.
 */
export function mutationRoutes(
  owners: MutationRouteOwners,
): Readonly<Record<MutationRouteKey, ApiRouter['invoke']>> {
  const { session } = owners;
  return Object.freeze({
    'POST /api/v1/authoring/preview': (call) =>
      admitted(call, owners, (mutation, signal) =>
        session.prepare(mutation.request, signal, mutation.preview),
      ),
    'POST /api/v1/authoring/apply': (call) =>
      admitted(call, owners, (mutation, signal) =>
        session.apply(mutation.request, signal, mutation.options),
      ),
  });
}

/**
 * Decodes the mutation envelope, then runs `step` on it. Fails as the decoder: `invalid-input` at
 * `content-type`, `body` or `request`, `conflict` at `generation`, `unauthorized` at `actor` or
 * `intent.planner`.
 */
async function admitted(
  call: ApiCall,
  owners: MutationRouteOwners,
  step: MutationStep,
): Promise<WireOutcome> {
  const mutation = owners.decoder.read(call.body, {
    caller: call.caller,
    metadata: call.metadata,
    generation: owners.generation,
    ingress: owners.admission,
  });
  if (!mutation.ok) return mutation;
  return step(mutation.value, call.signal);
}
