/*
 * The `/api/v1` router: one handler per `METHOD path`, composed from the route families. Session
 * routes forward to the session facade, source routes to the source readout, mutation routes to
 * the mutation decoder and resource routes to the resource commands. Pure over the injected
 * owners; no route writes storage, and Authoring owns commit and receipt recovery. The HTTP server
 * authenticates before `invoke`; a handler throw reaches its `receive`, which answers
 * `unavailable` at `request`.
 */
import type { WireOutcome } from '../../contract/records/transport/wire-codes.js';
import type { ApiRouter } from '../../contract/ports/transport.js';
import { failure } from '../../contract/errors.js';
import {
  mutationRoutes,
  type MutationRouteKey,
  type MutationRouteOwners,
} from './mutation-routes.js';
import {
  resourceRoutes,
  type ResourceRouteKey,
  type ResourceRouteOwners,
} from './resource-routes.js';
import { sessionRoutes, type SessionRouteKey, type SessionRouteOwners } from './session-routes.js';
import { sourceRoutes, type SourceRouteKey, type SourceRouteOwners } from './source-routes.js';

/** The owners every route family forwards to. */
export type RouteOwners = SessionRouteOwners &
  SourceRouteOwners &
  MutationRouteOwners &
  ResourceRouteOwners;

/** Every API route, as `METHOD path`. */
type RouteKey = SessionRouteKey | SourceRouteKey | MutationRouteKey | ResourceRouteKey;
/** The frozen table of every API route. */
type RouteTable = Readonly<Record<RouteKey, ApiRouter['invoke']>>;

/**
 * Binds the route table to the owners. `invoke` looks up `METHOD path` and runs its handler.
 * Fails with `not-found` at `route` when no handler matches; otherwise answers as the handler.
 */
export function createHttpRouter(owners: RouteOwners): ApiRouter {
  const routes = routeTable(owners);
  return {
    invoke: async (call) => {
      const key = `${call.metadata.method} ${call.path}`;
      if (!isRouteKey(routes, key)) return noRoute();
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

/** Whether the table has a route for `key`. */
function isRouteKey(
  routes: RouteTable,
  key: string,
): key is RouteKey {
  return Object.hasOwn(routes, key);
}

/** `not-found` at `route`: no handler serves this method and path. */
function noRoute(): WireOutcome {
  return failure('not-found', 'route', 'This method and API route are not available');
}
