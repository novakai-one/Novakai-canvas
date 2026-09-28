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
import type {
  ApiCall,
  ApiQuery,
  RouteKey,
  RouteOutcome,
} from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { success, type Result } from '../../contract/errors.js';
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

/** The `?history` value that asks for history versions without their contents. */
const VERSIONS_ONLY = 'versions';

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
    'GET /api/v1/workspace': jsonRoute((call) => readWorkspace(call, session)),
    'GET /api/v1/history': jsonRoute(() => session.history()),
    'GET /api/v1/installation': jsonRoute(() => readInstallation(session)),
    'GET /api/v1/identity': jsonRoute(() => readIdentity(session)),
    'GET /api/v1/render': jsonRoute((call) => renderCollection(call, session)),
    'GET /api/v1/inspect': jsonRoute((call) => inspectCollection(call, session)),
    'GET /api/v1/receipt': jsonRoute((call) => readReceipt(call, session)),
    'POST /api/v1/export': (call) => exportFile(call, session),
  });
}

/**
 * Reads the workspace snapshot; with `?history=versions`, history contents are stripped and
 * navigation kept. Authoring's read failures pass through.
 */
async function readWorkspace(
  call: ApiCall,
  session: RouteSession,
): Promise<HttpOutcome> {
  const snapshot = await session.read();
  if (!snapshot.ok) {
    return snapshot;
  }
  if (asksForVersionsOnly(call.query)) {
    const versions = stripHistoryContents(snapshot.value);
    return success(versions);
  }
  return snapshot;
}

/** Whether the query asks for history versions only (`?history=versions`). */
function asksForVersionsOnly(query: ApiQuery): boolean {
  const history = readLastValue(query, 'history');
  return history === VERSIONS_ONLY;
}

/** Answers the built-in fonts and design tokens. */
async function readInstallation(session: RouteSession): Promise<HttpOutcome> {
  const { fonts, tokens } = session.builtins;
  return success({ fonts, tokens });
}

/** Answers the workspace ID. */
async function readIdentity(session: RouteSession): Promise<HttpOutcome> {
  return success({ workspace: session.workspace });
}

/** Renders the `?id` collection: nodes placed and wires routed. Fails as `readCollectionId`. */
async function renderCollection(
  call: ApiCall,
  session: RouteSession,
): Promise<HttpOutcome> {
  const id = readCollectionId(call.query);
  if (!id.ok) {
    return id;
  }
  return session.render(id.value, call.signal);
}

/** Answers the quality report of the `?id` collection. Fails as `readCollectionId`. */
async function inspectCollection(
  call: ApiCall,
  session: RouteSession,
): Promise<HttpOutcome> {
  const id = readCollectionId(call.query);
  if (!id.ok) {
    return id;
  }
  return session.inspect(id.value, call.signal);
}

/** Answers what the saved request named by `?id` did. The session checks the ID. */
async function readReceipt(
  call: ApiCall,
  session: RouteSession,
): Promise<HttpOutcome> {
  const requestIdText = readLastValue(call.query, 'id');
  return session.receipt(requestIdText);
}

/**
 * Exports the body read as JSON, answering the file as bytes. Fails with `invalid-input` at
 * `content-type` or `body` as `readJsonBody` (json-body.ts); export failures pass through as JSON.
 */
async function exportFile(
  call: ApiCall,
  session: RouteSession,
): Promise<RouteOutcome> {
  const json = readJsonBody(call.body, call.metadata.contentType, 'resource');
  if (!json.ok) {
    return answerJson(json);
  }
  const file = await session.exportFile(json.value, call.signal);
  return answerFile(file);
}

/**
 * Reads `?id` as a Model collection ID. Fails with `not-found` at the query text when it isn't one
 * (an absent `?id` reads as empty text), the same answer as a missing collection.
 */
function readCollectionId(query: ApiQuery): Result<CollectionId> {
  const idText = readLastValue(query, 'id') ?? '';
  const id = collectionId.safeParse(idText);
  if (!id.success) {
    return missingCollectionFailure(idText);
  }
  return success(id.data);
}
