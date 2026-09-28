/*
 * Why this file exists
 *
 * The service answers 18 API routes, and each call must reach the right one. For example,
 * `GET /api/v1/render?id=walkthrough-modules` must reach the code that renders that collection.
 *
 * This file builds the router: one table from `METHOD path` to the code that answers it, made from
 * the four route groups (workspace, source, change and resource routes). A route that doesn't
 * exist answers `not-found`. It never checks who is calling (the server did that first) and never
 * writes storage.
 */
import type { ApiCall, RouteKey, RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { ApiRouter } from '../../contract/ports/transport.js';
import { routeKeys } from '../../contract/records/transport/protocol.js';
import { failure } from '../../contract/errors.js';
import { changeRoutes, type ChangeRouteDependencies } from './change-routes.js';
import { resourceRoutes, type ResourceRouteDependencies } from './resource-routes.js';
import { answerJson, type RouteHandler } from './route-answer.js';
import { sourceRoutes, type SourceRouteDependencies } from './source-routes.js';
import { workspaceRoutes, type WorkspaceRouteDependencies } from './workspace-routes.js';

/**
 * What the four route groups call: the workspace session, the DSL printer, the change checks and
 * the resource commands.
 */
export type RouterDependencies = WorkspaceRouteDependencies &
  SourceRouteDependencies &
  ChangeRouteDependencies &
  ResourceRouteDependencies;

/** The frozen table of every API route; the build fails when a family leaves a key out. */
type RouteTable = Readonly<Record<RouteKey, RouteHandler>>;

/** Every route key, for the membership check of `METHOD path` text. */
const ROUTE_KEYS: ReadonlySet<string> = new Set(routeKeys);

/**
 * Builds the router for one server. Its `invoke(call)` runs the route for the call's `METHOD path`
 * and answers its `RouteOutcome`. A route that doesn't exist answers `not-found` at `route`, as
 * JSON. If a route throws, `invoke` rejects, and the HTTP server answers `unavailable`.
 */
export function createApiRouter(dependencies: RouterDependencies): ApiRouter {
  const routes = routeTable(dependencies);
  return { invoke: (call) => invokeRoute(routes, call) };
}

/** Runs the route the call's `METHOD path` names, or answers `not-found` when there is none. */
async function invokeRoute(
  routes: RouteTable,
  call: ApiCall,
): Promise<RouteOutcome> {
  const key = `${call.metadata.method} ${call.path}`;
  if (!isRouteKey(key)) {
    return answerJson(noRouteFailure());
  }
  const route = routes[key];
  return route(call);
}

/** Joins every route family's table into one frozen table. Each family names its own failures. */
function routeTable(dependencies: RouterDependencies): RouteTable {
  return Object.freeze({
    ...workspaceRoutes(dependencies),
    ...sourceRoutes(dependencies),
    ...changeRoutes(dependencies),
    ...resourceRoutes(dependencies),
  });
}

/** Whether `METHOD path` text is one of the route keys. */
function isRouteKey(key: string): key is RouteKey {
  return ROUTE_KEYS.has(key);
}

/** Makes the mistake for a method and path no route answers. */
function noRouteFailure(): HttpOutcome {
  return failure('not-found', 'route', 'This method and API route are not available');
}
