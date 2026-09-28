/*
 * The `/api/v1` router: one handler per route key, composed from the route families. Session
 * routes forward to the session facade, source routes to the source readout, mutation routes to
 * the mutation decoder and resource routes to the resource commands. Pure over the injected
 * owners; no route writes storage, and Authoring owns commit and receipt recovery. The HTTP server
 * authenticates before `invoke`; a handler throw reaches its `receive`, which answers
 * `unavailable` at `request`.
 */
import type { RouteKey } from '../../contract/records/transport/protocol.js';
import type { WireOutcome } from '../../contract/records/transport/wire-codes.js';
import type { ApiRouter } from '../../contract/ports/transport.js';
import { routeKeys } from '../../contract/records/transport/protocol.js';
import { failure } from '../../contract/errors.js';
import { mutationRoutes, type MutationRouteOwners } from './mutation-routes.js';
import { resourceRoutes, type ResourceRouteOwners } from './resource-routes.js';
import { answerOutcome, type RouteHandler } from './route-answer.js';
import { sessionRoutes, type SessionRouteOwners } from './session-routes.js';
import { sourceRoutes, type SourceRouteOwners } from './source-routes.js';

/** The owners every route family forwards to. */
export type RouteOwners = SessionRouteOwners &
  SourceRouteOwners &
  MutationRouteOwners &
  ResourceRouteOwners;

/** The frozen table of every API route; the build fails when a family leaves a key out. */
type RouteTable = Readonly<Record<RouteKey, RouteHandler>>;

/** Every route key, for the membership check of `METHOD path` text. */
const ROUTE_KEYS: ReadonlySet<string> = new Set(routeKeys);

/**
 * Binds the route table to the owners. `invoke` looks up `METHOD path` and runs its handler.
 * Fails with `not-found` at `route` (as JSON) when no route key matches; otherwise answers as the
 * handler.
 */
export function createHttpRouter(owners: RouteOwners): ApiRouter {
  const routes = routeTable(owners);
  return {
    invoke: async (call) => {
      const key = `${call.metadata.method} ${call.path}`;
      if (!isRouteKey(key)) return answerOutcome(noRoute());
      return routes[key](call);
    },
  };
}

/** Every route family's table in one frozen table. Handler failures are named in each family. */
function routeTable(owners: RouteOwners): RouteTable {
  return Object.freeze({
    ...sessionRoutes(owners),
    ...sourceRoutes(owners),
    ...mutationRoutes(owners),
    ...resourceRoutes(owners),
  });
}

/** Whether `METHOD path` text is one of the route keys. */
function isRouteKey(key: string): key is RouteKey {
  return ROUTE_KEYS.has(key);
}

/** `not-found` at `route`: no handler serves this method and path. */
function noRoute(): WireOutcome {
  return failure('not-found', 'route', 'This method and API route are not available');
}
