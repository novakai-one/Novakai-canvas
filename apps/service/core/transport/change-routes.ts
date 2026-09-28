/*
 * Why this file exists
 *
 * The browser and the CLI change a diagram in two steps: preview the change, then apply it. For
 * example, `pnpm canvas preview` posts to `/api/v1/authoring/preview`, and `pnpm canvas apply`
 * posts to `/api/v1/authoring/apply`.
 *
 * This file is those two routes. Each reads the change body with the body reader it is given
 * (change-body.ts), then passes the change to the workspace session. It never saves anything
 * itself; Authoring decides whether a change is saved.
 */
import type {
  AdmittedChange,
  ApiCall,
  RouteKey,
} from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type {
  BodyCheckContext,
  ChangeBodyReader,
  HttpAdmission,
} from '../../contract/ports/transport.js';
import type { WorkspaceSession } from '../../contract/types.js';
import type { Generation } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { jsonRoute, type RouteHandler } from './route-answer.js';

/** A change route, as `METHOD path`: every route under `/api/v1/authoring/`. */
export type ChangeRouteKey = Extract<RouteKey, `POST /api/v1/authoring/${string}`>;

/**
 * What the change routes call: the workspace session and the body reader. `generation` and
 * `admission` are handed to the body reader, which checks the body against them.
 */
export interface ChangeRouteDependencies {
  readonly session: Pick<WorkspaceSession, 'prepare' | 'apply'>;
  readonly generation: Generation;
  readonly admission: Pick<HttpAdmission, 'admitChange'>;
  readonly bodyReader: ChangeBodyReader;
}

/**
 * Builds the two change routes; both answer JSON. `preview` calls the session's `prepare`, which
 * works out what the change would do without saving it; `apply` calls `apply`, which saves it. A
 * body the reader refuses is sent back as that mistake; Authoring's answers pass through.
 */
export function changeRoutes(
  dependencies: ChangeRouteDependencies,
): Readonly<Record<ChangeRouteKey, RouteHandler>> {
  return Object.freeze({
    'POST /api/v1/authoring/preview': jsonRoute((call) => previewChange(call, dependencies)),
    'POST /api/v1/authoring/apply': jsonRoute((call) => applyChange(call, dependencies)),
  });
}

/** Reads the change from the body, then asks the session what it would do, without saving it. */
async function previewChange(
  call: ApiCall,
  dependencies: ChangeRouteDependencies,
): Promise<HttpOutcome> {
  const change = readChange(call, dependencies);
  if (!change.ok) {
    return change;
  }
  return dependencies.session.prepare(change.value.request, call.signal, change.value.mode);
}

/** Reads the change from the body, then asks the session to save it. */
async function applyChange(
  call: ApiCall,
  dependencies: ChangeRouteDependencies,
): Promise<HttpOutcome> {
  const change = readChange(call, dependencies);
  if (!change.ok) {
    return change;
  }
  return dependencies.session.apply(change.value.request, call.signal, change.value.options);
}

/**
 * Reads the change with the body reader, checked against this server run and the caller. Fails as
 * the body reader: `invalid-input` at `content-type`, `body` or `request`, `conflict` at
 * `generation`, `unauthorized` at `actor` or `intent.planner`.
 */
function readChange(
  call: ApiCall,
  dependencies: ChangeRouteDependencies,
): Result<AdmittedChange> {
  const context: BodyCheckContext = {
    caller: call.caller,
    metadata: call.metadata,
    generation: dependencies.generation,
    admission: dependencies.admission,
  };
  return dependencies.bodyReader.read(call.body, context);
}
