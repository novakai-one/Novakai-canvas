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

/** One resource command, run on the body read as JSON. */
type BodyCommand = (json: unknown) => Promise<HttpOutcome>;
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
    'POST /api/v1/resources/stage': resourceRoute((json) => resources.storeUpload(json)),
    'POST /api/v1/resources/restore': resourceRoute((json) => resources.restore(json)),
    'POST /api/v1/resources/blob': resourceRoute(async (json) => resources.readFile(json)),
    'POST /api/v1/resources/freeze': resourceRoute((json) =>
      runOnSnapshot(json, dependencies, 'freeze'),
    ),
    'POST /api/v1/resources/prepare': resourceRoute((json) =>
      runOnSnapshot(json, dependencies, 'preparePreset'),
    ),
    'POST /api/v1/resources/instantiate': resourceRoute((json) =>
      runOnSnapshot(json, dependencies, 'instantiate'),
    ),
  });
}

/** Makes the route that reads the body as JSON, then runs `command` on it. */
function resourceRoute(command: BodyCommand): RouteHandler {
  return jsonRoute((call) => runOnJsonBody(call, command));
}

/**
 * Reads the body as JSON, then runs `command` on it. Fails with `invalid-input` at `content-type`
 * or `body` as `readJsonBody` (json-body.ts). The server authenticates before reading the body.
 */
async function runOnJsonBody(
  call: ApiCall,
  command: BodyCommand,
): Promise<HttpOutcome> {
  const json = readJsonBody(call.body, call.metadata.contentType, 'resource');
  if (!json.ok) {
    return json;
  }
  return command(json.value);
}

/**
 * Reads the current snapshot, then runs `command` on the body and that snapshot. The command
 * changes no diagram until an Authoring apply. Authoring's read failures pass through.
 */
async function runOnSnapshot(
  json: unknown,
  dependencies: ResourceRouteDependencies,
  command: SnapshotCommand,
): Promise<HttpOutcome> {
  const snapshot = await dependencies.session.read();
  if (!snapshot.ok) {
    return snapshot;
  }
  return dependencies.resources[command](json, snapshot.value);
}
