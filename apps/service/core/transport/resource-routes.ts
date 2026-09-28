/*
 * Why this file exists
 *
 * Diagrams use images, fonts, themes and recipes, and the web app and the CLI manage them through
 * six routes under `/api/v1/resources/`: `stage` (store an uploaded file), `restore` (put a file
 * back from a backup), `blob` (read a stored file), `freeze` (pin the themes a change names to
 * exact versions), `prepare` (check a theme or recipe before it is saved) and `instantiate` (turn
 * a recipe into DSL).
 *
 * This file is those six routes. Each reads a JSON body and passes it to the resource commands; no
 * diagram changes until a change is applied through Authoring.
 */
import type { ApiCall, RouteKey } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { ResourceCommands } from '../../contract/ports/workspace.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { readJsonBody } from './json-body.js';
import { jsonRoute, type RouteHandler } from './route-answer.js';

/** A resource route, as `METHOD path`: every route under `/api/v1/resources/`. */
export type ResourceRouteKey = Extract<RouteKey, `POST /api/v1/resources/${string}`>;

/**
 * What the resource routes call: the workspace session's `read` (for the snapshot), and the
 * resource commands.
 */
export interface ResourceRouteDependencies {
  readonly session: Pick<WorkspaceSession, 'read'>;
  readonly resources: ResourceCommands;
}

/** One resource command run on the admitted body. */
type ResourceHandler = (input: unknown) => Promise<HttpOutcome>;
/** The resource commands that bind the current snapshot. */
type SnapshotCommand = 'freeze' | 'preparePreset' | 'instantiate';

/**
 * Builds the six resource routes; all answer JSON. A body that isn't JSON answers `invalid-input`
 * at `content-type` or `body` (the part that was wrong). The commands' answers, and a failed
 * snapshot read, pass through.
 */
export function resourceRoutes(
  dependencies: ResourceRouteDependencies,
): Readonly<Record<ResourceRouteKey, RouteHandler>> {
  const { resources } = dependencies;
  return Object.freeze({
    'POST /api/v1/resources/stage': resourceRoute((input) => resources.storeUpload(input)),
    'POST /api/v1/resources/restore': resourceRoute((input) => resources.restore(input)),
    'POST /api/v1/resources/blob': resourceRoute(async (input) => resources.readFile(input)),
    'POST /api/v1/resources/freeze': resourceRoute(onSnapshot(dependencies, 'freeze')),
    'POST /api/v1/resources/prepare': resourceRoute(onSnapshot(dependencies, 'preparePreset')),
    'POST /api/v1/resources/instantiate': resourceRoute(onSnapshot(dependencies, 'instantiate')),
  });
}

/** The route that runs `handler` on the body read as JSON (`runOnJsonBody`). */
function resourceRoute(handler: ResourceHandler): RouteHandler {
  return jsonRoute((call) => runOnJsonBody(call, handler));
}

/**
 * Runs `handler` on the body read as JSON. Fails with `invalid-input` at `content-type` or `body`
 * as `readJsonBody` (json-body.ts). The server authenticates before reading the body.
 */
async function runOnJsonBody(
  call: ApiCall,
  handler: ResourceHandler,
): Promise<HttpOutcome> {
  const input = readJsonBody(call.body, call.metadata.contentType, 'resource');
  if (!input.ok) return input;
  return handler(input.value);
}

/**
 * A handler that reads the current snapshot, then runs `command` on it. The command stays
 * mutation-free until an Authoring apply. Authoring's read failures pass through.
 */
function onSnapshot(
  dependencies: ResourceRouteDependencies,
  command: SnapshotCommand,
): ResourceHandler {
  return async (input) => {
    const snapshot = await dependencies.session.read();
    if (!snapshot.ok) return snapshot;
    return dependencies.resources[command](input, snapshot.value);
  };
}
