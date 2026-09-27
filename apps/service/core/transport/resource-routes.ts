/*
 * The six `POST /api/v1/resources/*` routes: each reads a JSON body and forwards it to the
 * resource commands; freeze, prepare and instantiate first read the current snapshot. Pure over
 * the injected owners; no route writes storage. A refused body is the caller's to correct;
 * Authoring owns commit and receipt recovery. A throw reaches the HTTP server's `receive`
 * (routes.ts).
 */
import type { ApiCall } from '../../contract/records/transport/protocol.js';
import type { WireOutcome } from '../../contract/records/transport/wire-codes.js';
import type { ApiRouter } from '../../contract/ports/transport.js';
import type { ResourceCommands } from '../../contract/ports/workspace.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { jsonBody } from './json-body.js';

/** A resource route, as `METHOD path`. */
export type ResourceRouteKey =
  | 'POST /api/v1/resources/stage'
  | 'POST /api/v1/resources/restore'
  | 'POST /api/v1/resources/blob'
  | 'POST /api/v1/resources/freeze'
  | 'POST /api/v1/resources/prepare'
  | 'POST /api/v1/resources/instantiate';

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
 * The frozen resource route table. Every route fails as `resource`; freeze, prepare and
 * instantiate also as `onSnapshot`. Resource command outcomes pass through.
 */
export function resourceRoutes(
  owners: ResourceRouteOwners,
): Readonly<Record<ResourceRouteKey, ApiRouter['invoke']>> {
  const { resources } = owners;
  const freeze = onSnapshot(owners, 'freeze');
  const prepare = onSnapshot(owners, 'preparePreset');
  const instantiate = onSnapshot(owners, 'instantiate');
  return Object.freeze({
    'POST /api/v1/resources/stage': (call) => resource(call, (input) => resources.stage(input)),
    'POST /api/v1/resources/restore': (call) => resource(call, (input) => resources.restore(input)),
    'POST /api/v1/resources/blob': (call) => resource(call, async (input) => resources.blob(input)),
    'POST /api/v1/resources/freeze': (call) => resource(call, freeze),
    'POST /api/v1/resources/prepare': (call) => resource(call, prepare),
    'POST /api/v1/resources/instantiate': (call) => resource(call, instantiate),
  });
}

/**
 * Runs `handler` on the body read as JSON. Fails with `invalid-input` at `content-type` or `body`
 * as `jsonBody` (json-body.ts). The server authenticates before reading the body.
 */
async function resource(
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
