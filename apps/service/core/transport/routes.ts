/*
 * Why this file exists
 *
 * The service answers 18 API routes, and each call must reach the right one. For example,
 * `GET /api/v1/render?id=walkthrough-modules` must reach the code that renders that collection.
 *
 * This file builds the router: one table from `METHOD path` to the code that answers it, made from
 * the four route groups (session, source, change and resource routes). A route that doesn't exist
 * answers `not-found`. It never checks who is calling (the server did that first) and never writes
 * storage.
 */
import type { RouteKey } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { ApiRouter } from '../../contract/ports/transport.js';
import { routeKeys } from '../../contract/records/transport/protocol.js';
import { failure } from '../../contract/errors.js';
import { changeRoutes, type ChangeRouteDependencies } from './change-routes.js';
import { resourceRoutes, type ResourceRouteDependencies } from './resource-routes.js';
import { answerJson, type RouteHandler } from './route-answer.js';
import { sessionRoutes, type SessionRouteDependencies } from './session-routes.js';
import { sourceRoutes, type SourceRouteDependencies } from './source-routes.js';

/**
 * What the four route groups call: the workspace session, Language's readout, the change checks
 * and the resource commands.
 */
export type RouterDependencies = SessionRouteDependencies &
  SourceRouteDependencies &
  ChangeRouteDependencies &
  ResourceRouteDependencies;

/** The frozen table of every API route; the build fails when a family leaves a key out. */
type RouteTable = Readonly<Record<RouteKey, RouteHandler>>;

/** Every route key, for the membership check of `METHOD path` text. */
const ROUTE_KEYS: ReadonlySet<string> = new Set(routeKeys);

/**
 * Builds the router for one server. Its `invoke` finds the route for the call's `METHOD path` and
 * runs it. A route that doesn't exist answers `not-found` at `route`, as JSON. If a route throws,
 * `invoke` rejects, and the HTTP server answers `unavailable`.
 */
export function createApiRouter(dependencies: RouterDependencies): ApiRouter {
  const routes = routeTable(dependencies);
  return {
    invoke: async (call) => {
      const key = `${call.metadata.method} ${call.path}`;
      if (!isRouteKey(key)) return answerJson(noRoute());
      return routes[key](call);
    },
  };
}

/** Every route family's table in one frozen table. Handler failures are named in each family. */
function routeTable(dependencies: RouterDependencies): RouteTable {
  return Object.freeze({
    ...sessionRoutes(dependencies),
    ...sourceRoutes(dependencies),
    ...changeRoutes(dependencies),
    ...resourceRoutes(dependencies),
  });
}

/** Whether `METHOD path` text is one of the route keys. */
function isRouteKey(key: string): key is RouteKey {
  return ROUTE_KEYS.has(key);
}

/** `not-found` at `route`: no handler serves this method and path. */
function noRoute(): HttpOutcome {
  return failure('not-found', 'route', 'This method and API route are not available');
}
