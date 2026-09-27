/*
 * The HTTP seam to the local service: one GET or POST to a route from a closed list. Declaration
 * only; adapters/service-http/transport.ts implements it and compose binds it to one loopback
 * origin and the agent token. Every method returns its failure as a value.
 */
import type { Result } from '../errors.js';
import type { Observed } from '../records/service-answers.js';

/** The service routes a read-only command asks. */
export type ReadRoute =
  | '/api/v1/language'
  | '/api/v1/workspace'
  | '/api/v1/source'
  | '/api/v1/inspect'
  | '/api/v1/receipt';

/** The Assets and Templates steps under `/api/v1/resources/`. */
export type ResourceAction = 'stage' | 'blob' | 'freeze' | 'restore' | 'prepare' | 'instantiate';

/** The service routes a command posts to. */
export type WriteRoute =
  '/api/v1/authoring/preview' | '/api/v1/authoring/apply' | `/api/v1/resources/${ResourceAction}`;

/** Query parameters of a read route, in the order they are sent. */
export type RouteQuery = Readonly<Record<string, string>>;

/**
 * Sends one request to the local service; nothing is retried. Every method fails with
 * `connection-uncertain` (no confirmed answer: reconcile the receipt before retrying),
 * `invalid-response` (the answer is not a service envelope) or `service-rejected` (the service's
 * own failure record, kept whole).
 */
export interface HttpTransport {
  get(
    route: ReadRoute,
    query?: RouteQuery,
  ): Promise<Result<Observed<unknown>>>;
  post(
    route: WriteRoute,
    body: unknown,
  ): Promise<Result<Observed<unknown>>>;
}
