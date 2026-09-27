/*
 * The six `POST /api/v1/resources/*` routes: each reads a JSON body and forwards it to the
 * resource commands; freeze, prepare and instantiate first read the current snapshot. Pure over
 * the injected owners; no route writes storage. A refused body is the caller's to correct;
 * Authoring owns commit and receipt recovery. A throw reaches the HTTP server's `receive`
 * (routes.ts).
 */
import type { ApiCall, RouteKey } from '../../contract/records/transport/protocol.js';
import type { WireOutcome } from '../../contract/records/transport/wire-codes.js';
import type { ResourceCommands } from '../../contract/ports/workspace.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { jsonBody } from './json-body.js';
import { answerJson, type RouteHandler } from './route-answer.js';

/** A resource route, as `METHOD path`: every route under `/api/v1/resources/`. */
export type ResourceRouteKey = Extract<RouteKey, `POST /api/v1/resources/${string}`>;

/** The owners the resource routes forward to. */
export interface ResourceRouteOwners {
  readonly session: Pick<WorkspaceSession, 'read'>;
  readonly resources: ResourceCommands;
}

/** One resource command run on the admitted body. */
type ResourceHandler = (input: unknown) => Promise<WireOutcome>;
/** The resource commands that bind the current snapshot. */
type SnapshotCommand = 'freeze' | 'preparePreset' | 'instantiate';

/**
 * The frozen resource route table; every route answers JSON. Every route fails as `resource`;
 * freeze, prepare and instantiate also as `onSnapshot`. Resource command outcomes pass through.
 */
export function resourceRoutes(
  owners: ResourceRouteOwners,
): Readonly<Record<ResourceRouteKey, RouteHandler>> {
  const { resources } = owners;
  return Object.freeze({
    'POST /api/v1/resources/stage': resource((input) => resources.stage(input)),
    'POST /api/v1/resources/restore': resource((input) => resources.restore(input)),
    'POST /api/v1/resources/blob': resource(async (input) => resources.blob(input)),
    'POST /api/v1/resources/freeze': resource(onSnapshot(owners, 'freeze')),
    'POST /api/v1/resources/prepare': resource(onSnapshot(owners, 'preparePreset')),
    'POST /api/v1/resources/instantiate': resource(onSnapshot(owners, 'instantiate')),
  });
}

/** The route that runs `handler` on the body read as JSON (`jsonInput`). */
function resource(handler: ResourceHandler): RouteHandler {
  return answerJson((call) => jsonInput(call, handler));
}

/**
 * Runs `handler` on the body read as JSON. Fails with `invalid-input` at `content-type` or `body`
 * as `jsonBody` (json-body.ts). The server authenticates before reading the body.
 */
async function jsonInput(
  call: ApiCall,
  handler: ResourceHandler,
): Promise<WireOutcome> {
  const input = jsonBody(call.body, call.metadata.contentType, 'resource');
  if (!input.ok) return input;
  return handler(input.value);
}

/**
 * A handler that reads the current snapshot, then runs `command` on it. The command stays
 * mutation-free until an Authoring apply. Authoring's read failures pass through.
 */
function onSnapshot(
  owners: ResourceRouteOwners,
  command: SnapshotCommand,
): ResourceHandler {
  return async (input) => {
    const snapshot = await owners.session.read();
    if (!snapshot.ok) return snapshot;
    return owners.resources[command](input, snapshot.value);
  };
}
