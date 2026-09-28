/*
 * The Language routes: `GET /api/v1/language` answers Language's vocabulary and
 * `GET /api/v1/source` prints one current collection as DSL for a scope. Pure over the injected
 * owners. A refused scope or print is the caller's to correct. A throw, Language's included,
 * reaches the HTTP server's `receive` (routes.ts).
 */
import type { ApiCall, RouteKey } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { Scope, Snapshot, StoredRecord } from '../../contract/records/capability-types.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { liveRecord } from '../workspace/records.js';
import { sourceScope } from './source-scope.js';
import { readLastValue } from './api-query.js';
import { answerJson, type RouteHandler } from './route-answer.js';

/** A Language route, as `METHOD path`. */
export type SourceRouteKey = Extract<RouteKey, 'GET /api/v1/language' | 'GET /api/v1/source'>;

/** Language's vocabulary and DSL printing, as the source routes read them. */
export interface SourceReadout {
  describe(): unknown;
  print(
    collection: unknown,
    scope: Scope,
  ): Result<unknown>;
}

/** The owners the Language routes forward to. */
export interface SourceRouteOwners {
  readonly session: Pick<WorkspaceSession, 'read'>;
  readonly source: SourceReadout;
}

/**
 * The frozen Language route table; both answer JSON. `language` cannot fail; `source` fails as
 * `source` below.
 */
export function sourceRoutes(
  owners: SourceRouteOwners,
): Readonly<Record<SourceRouteKey, RouteHandler>> {
  return Object.freeze({
    'GET /api/v1/language': answerJson(async () => success(owners.source.describe())),
    'GET /api/v1/source': answerJson((call) => source(call, owners)),
  });
}

/**
 * One current collection printed as DSL for the `section` or `object` scope (all when neither).
 * Fails with `invalid-input` at `scope` as `sourceScope` (source-scope.ts), and as
 * `readSourceRecord`.
 */
async function source(
  call: ApiCall,
  owners: SourceRouteOwners,
): Promise<HttpOutcome> {
  const scope = sourceScope(call.query);
  if (!scope.ok) return scope;
  return readSourceRecord(call, owners, scope.value);
}

/**
 * Reads the live collection named by `?id` and prints it without reinterpreting its shape;
 * Language validates it. Fails with `not-found` at `collection` when `?id` is missing or the
 * collection is absent or deleted. Authoring's read failures and the readout's `invalid-input`
 * at `source` pass through.
 */
async function readSourceRecord(
  call: ApiCall,
  owners: SourceRouteOwners,
  scope: Scope,
): Promise<HttpOutcome> {
  const snapshot = await owners.session.read();
  if (!snapshot.ok) return snapshot;
  const record = sourceRecord(snapshot.value, readLastValue(call.query, 'id'));
  if (!record) return failure('not-found', 'collection', 'Collection was not found');
  return owners.source.print(record.value, scope);
}

/** The live collection record for `?id`; `undefined` when `?id` is missing or none is live. */
function sourceRecord(
  snapshot: Snapshot,
  id: string | undefined,
): StoredRecord | undefined {
  if (id === undefined) return undefined;
  return liveRecord(snapshot, 'collection', id);
}
