/*
 * Why this file exists
 *
 * Most of what the web app and the CLI read comes from the open workspace. For example,
 * `GET /api/v1/render?id=walkthrough-modules` answers that collection laid out, with its nodes
 * placed and wires routed.
 *
 * This file is the eight routes that pass such calls to the workspace session: `workspace` (every
 * saved record), `history` (undo and redo), `installation` (built-in fonts and design tokens),
 * `identity` (the workspace ID), `render`, `inspect` (a quality report), `receipt` (what a saved
 * request did) and `export` (a DSL, Markdown, SVG or PNG file). It never writes storage.
 */
import type { ApiCall, RouteKey, RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { success } from '../../contract/errors.js';
import type { CollectionId } from '../../contract/brands.js';
import { collectionId } from '../../contract/schemas.js';
import { missingCollectionFailure } from '../rendering/collection.js';
import { stripHistoryContents } from '../session/history-versions.js';
import { readJsonBody } from './json-body.js';
import { readLastValue } from './api-query.js';
import { answerFile, answerJson, jsonRoute, type RouteHandler } from './route-answer.js';

/** A workspace route, as `METHOD path`. */
export type WorkspaceRouteKey = Extract<
  RouteKey,
  | 'GET /api/v1/workspace'
  | 'GET /api/v1/history'
  | 'GET /api/v1/installation'
  | 'GET /api/v1/identity'
  | 'GET /api/v1/render'
  | 'GET /api/v1/inspect'
  | 'GET /api/v1/receipt'
  | 'POST /api/v1/export'
>;

/** What the workspace routes call: the workspace session's read, render and export calls. */
export interface WorkspaceRouteDependencies {
  readonly session: Pick<
    WorkspaceSession,
    'workspace' | 'builtins' | 'read' | 'history' | 'receipt' | 'render' | 'inspect' | 'exportFile'
  >;
}

/** The workspace session, as the workspace routes read it. */
type RouteSession = WorkspaceRouteDependencies['session'];

/**
 * Builds the eight workspace routes. `export` answers a file's bytes; the rest answer JSON. The
 * session's answers pass through: `workspace` calls `read`, `installation` reads `builtins`, and
 * `identity` reads `workspace`. `render` and `inspect` answer `not-found` when `?id` isn't a
 * collection ID, and `export` answers `invalid-input` for a body that isn't JSON.
 */
export function workspaceRoutes(
  dependencies: WorkspaceRouteDependencies,
): Readonly<Record<WorkspaceRouteKey, RouteHandler>> {
  const { session } = dependencies;
  return Object.freeze({
    'GET /api/v1/workspace': jsonRoute((call) => workspace(call, session)),
    'GET /api/v1/history': jsonRoute(() => session.history()),
    'GET /api/v1/installation': jsonRoute(async () =>
      success({ fonts: session.builtins.fonts, tokens: session.builtins.tokens }),
    ),
    'GET /api/v1/identity': jsonRoute(async () => success({ workspace: session.workspace })),
    'GET /api/v1/render': jsonRoute((call) =>
      withCollection(call, (id) => session.render(id, call.signal)),
    ),
    'GET /api/v1/inspect': jsonRoute((call) =>
      withCollection(call, (id) => session.inspect(id, call.signal)),
    ),
    'GET /api/v1/receipt': jsonRoute((call) => session.receipt(readLastValue(call.query, 'id'))),
    'POST /api/v1/export': (call) => exportArtifact(call, session),
  });
}

/**
 * The workspace snapshot; with `?history=versions`, history contents are stripped and navigation
 * kept. Authoring's read failures pass through.
 */
async function workspace(
  call: ApiCall,
  session: RouteSession,
): Promise<HttpOutcome> {
  const read = await session.read();
  if (!read.ok) return read;
  const versionsOnly = readLastValue(call.query, 'history') === 'versions';
  if (!versionsOnly) return read;
  return success(stripHistoryContents(read.value));
}

/**
 * Exports the body read as JSON, answering the file as bytes. Fails with `invalid-input` at
 * `content-type` or `body` as `readJsonBody` (json-body.ts); export failures pass through as JSON.
 */
async function exportArtifact(
  call: ApiCall,
  session: RouteSession,
): Promise<RouteOutcome> {
  const input = readJsonBody(call.body, call.metadata.contentType, 'resource');
  if (!input.ok) return answerJson(input);
  const file = await session.exportFile(input.value, call.signal);
  return answerFile(file);
}

/**
 * Runs `step` on the `?id` collection. Fails with `not-found` at the query text when it is not a
 * Model collection ID (an absent `?id` reads as empty text), the same answer as a missing
 * collection (`missingCollectionFailure`); otherwise `step`'s outcome passes through.
 */
async function withCollection(
  call: ApiCall,
  step: (id: CollectionId) => Promise<HttpOutcome>,
): Promise<HttpOutcome> {
  const text = readLastValue(call.query, 'id') ?? '';
  const id = collectionId.safeParse(text);
  if (!id.success) return missingCollectionFailure(text);
  return step(id.data);
}
