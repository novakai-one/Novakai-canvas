/*
 * The session routes: workspace, history, installation and identity reads, render, inspect,
 * receipt and export, each forwarded to the session facade. Render and inspect parse `?id` as a
 * Model collection ID first. Pure over the injected session; no route writes storage. Authoring
 * owns commit and receipt recovery; a refused export body is the caller's to correct. A throw
 * reaches the HTTP server's `receive` (routes.ts).
 */
import type { ApiCall, RouteKey, RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { success } from '../../contract/errors.js';
import type { CollectionId } from '../../contract/brands.js';
import { collectionId } from '../../contract/schemas.js';
import { missingCollection } from '../rendering/collection.js';
import { historyVersionsOnly } from '../session/history-versions.js';
import { jsonBody } from './json-body.js';
import { readLastValue } from './api-query.js';
import { answerFile, answerOutcome, answerJson, type RouteHandler } from './route-answer.js';

/** A session route, as `METHOD path`. */
export type SessionRouteKey = Extract<
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

/** The owner the session routes forward to. */
export interface SessionRouteOwners {
  readonly session: Pick<
    WorkspaceSession,
    | 'workspace'
    | 'builtins'
    | 'read'
    | 'history'
    | 'receipt'
    | 'render'
    | 'inspect'
    | 'exportArtifact'
  >;
}

/** The session facade, as the session routes read it. */
type RouteSession = SessionRouteOwners['session'];

/**
 * The frozen session route table. `workspace`, `render`, `inspect` and `export` fail as their
 * handlers below; every other route passes the session's outcome through (`installation` and
 * `identity` cannot fail). Export answers its file as bytes; every other answer is JSON.
 */
export function sessionRoutes(
  owners: SessionRouteOwners,
): Readonly<Record<SessionRouteKey, RouteHandler>> {
  const { session } = owners;
  return Object.freeze({
    'GET /api/v1/workspace': answerJson((call) => workspace(call, session)),
    'GET /api/v1/history': answerJson(() => session.history()),
    'GET /api/v1/installation': answerJson(async () =>
      success({ fonts: session.builtins.fonts, tokens: session.builtins.tokens }),
    ),
    'GET /api/v1/identity': answerJson(async () => success({ workspace: session.workspace })),
    'GET /api/v1/render': answerJson((call) =>
      withCollection(call, (id) => session.render(id, call.signal)),
    ),
    'GET /api/v1/inspect': answerJson((call) =>
      withCollection(call, (id) => session.inspect(id, call.signal)),
    ),
    'GET /api/v1/receipt': answerJson((call) => session.receipt(readLastValue(call.query, 'id'))),
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
  return success(historyVersionsOnly(read.value));
}

/**
 * Exports the body read as JSON, answering the file as bytes. Fails with `invalid-input` at
 * `content-type` or `body` as `jsonBody` (json-body.ts); export failures pass through as JSON.
 */
async function exportArtifact(
  call: ApiCall,
  session: RouteSession,
): Promise<RouteOutcome> {
  const input = jsonBody(call.body, call.metadata.contentType, 'resource');
  if (!input.ok) return answerOutcome(input);
  const file = await session.exportArtifact(input.value, call.signal);
  return answerFile(file);
}

/**
 * Runs `step` on the `?id` collection. Fails with `not-found` at the query text when it is not a
 * Model collection ID (an absent `?id` reads as empty text), the same answer as a missing
 * collection (`missingCollection`); otherwise `step`'s outcome passes through.
 */
async function withCollection(
  call: ApiCall,
  step: (id: CollectionId) => Promise<HttpOutcome>,
): Promise<HttpOutcome> {
  const text = readLastValue(call.query, 'id') ?? '';
  const id = collectionId.safeParse(text);
  if (!id.success) return missingCollection(text);
  return step(id.data);
}
