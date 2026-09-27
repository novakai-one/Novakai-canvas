/*
 * The session routes: workspace, history, installation and identity reads, render, inspect,
 * receipt and export, each forwarded to the session facade. Pure over the injected session; no
 * route writes storage. Authoring owns commit and receipt recovery; a refused export body is the
 * caller's to correct. A throw reaches the HTTP server's `receive` (routes.ts).
 */
import type {
  ApiCall,
  RouteOutcome,
  WireOutcome,
} from '../../contract/records/transport/protocol.js';
import type { ApiRouter } from '../../contract/ports/transport.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { success } from '../../contract/errors.js';
import { historyVersionsOnly } from '../session/history-versions.js';
import { jsonBody } from './json-body.js';

/** A session route, as `METHOD path`. */
export type SessionRouteKey =
  | 'GET /api/v1/workspace'
  | 'GET /api/v1/history'
  | 'GET /api/v1/installation'
  | 'GET /api/v1/identity'
  | 'GET /api/v1/render'
  | 'GET /api/v1/inspect'
  | 'GET /api/v1/receipt'
  | 'POST /api/v1/export';

/** The owner the session routes forward to. */
export interface SessionRouteOwners {
  readonly session: Pick<
    WorkspaceSession,
    | 'workspace'
    | 'installation'
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
 * The frozen session route table. `workspace` and `export` fail as their handlers below; every
 * other route passes the session's outcome through (`installation` and `identity` cannot fail).
 */
export function sessionRoutes(
  owners: SessionRouteOwners,
): Readonly<Record<SessionRouteKey, ApiRouter['invoke']>> {
  const { session } = owners;
  return Object.freeze({
    'GET /api/v1/workspace': (call) => workspace(call, session),
    'GET /api/v1/history': () => session.history(),
    'GET /api/v1/installation': async () =>
      success({ fonts: session.installation.fonts, tokens: session.installation.tokens }),
    'GET /api/v1/identity': async () => success({ workspace: session.workspace }),
    'GET /api/v1/render': (call) => session.render(collectionQuery(call), call.signal),
    'GET /api/v1/inspect': (call) => session.inspect(collectionQuery(call), call.signal),
    'GET /api/v1/receipt': (call) => session.receipt(call.query.id),
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
): Promise<WireOutcome> {
  const read = await session.read();
  if (!read.ok || call.query.history !== 'versions') return read;
  return success(historyVersionsOnly(read.value));
}

/**
 * Exports the body read as JSON. Fails with `invalid-input` at `content-type` or `body` as
 * `jsonBody` (json-body.ts); export outcomes pass through.
 */
async function exportArtifact(
  call: ApiCall,
  session: RouteSession,
): Promise<RouteOutcome> {
  const input = jsonBody(call.body, call.metadata.contentType, 'resource');
  if (!input.ok) return input;
  return session.exportArtifact(input.value, call.signal);
}

/** The `?id` collection; empty when absent, which render and inspect answer with `not-found`. */
function collectionQuery(call: ApiCall): string {
  return call.query.id ?? '';
}
