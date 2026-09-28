/*
 * Why this file exists
 *
 * Every service command talks to the local service over HTTP, one call at a time. `read my-diagram`
 * becomes `GET /api/v1/source?id=my-diagram`. A call can fail in ways the agent must tell apart:
 * no sure answer, an answer that isn't the service's, or the service saying no.
 *
 * This file names that call, and the fixed list of routes it may use. It never retries.
 * `adapters/service-http/transport.ts` makes the call.
 */
import type { Result } from '../errors.js';
import type { ServiceAnswer } from '../records/service-answers.js';

/** The routes a command may read from. Reading changes nothing. */
export type ReadRoute =
  | '/api/v1/language'
  | '/api/v1/workspace'
  | '/api/v1/source'
  | '/api/v1/inspect'
  | '/api/v1/receipt';

/** The font, image, theme and recipe steps under `/api/v1/resources/` (`service-resources.ts`). */
export type ResourceAction = 'stage' | 'blob' | 'freeze' | 'restore' | 'prepare' | 'instantiate';

/** The routes a command may send a change or a file to. */
export type WriteRoute =
  '/api/v1/authoring/preview' | '/api/v1/authoring/apply' | `/api/v1/resources/${ResourceAction}`;

/** A read route's query, such as `{ id: 'my-diagram' }`. Keys are sent in the order written. */
export type RouteQuery = Readonly<Record<string, string>>;

/**
 * One HTTP call to the local service. Each fails with `connection-uncertain` (no sure answer),
 * `invalid-response` (the answer isn't the service's) or `service-rejected` (the service said no).
 */
export interface HttpTransport {
  /** Reads from `route`. Gives back what the service answered, not checked yet. */
  get(
    route: ReadRoute,
    query?: RouteQuery,
  ): Promise<Result<ServiceAnswer<unknown>>>;
  /** Sends `body` to `route`. Gives back what the service answered, not checked yet. */
  post(
    route: WriteRoute,
    body: unknown,
  ): Promise<Result<ServiceAnswer<unknown>>>;
}
