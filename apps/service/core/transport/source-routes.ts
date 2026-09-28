/*
 * Why this file exists
 *
 * An agent can't look at a diagram's picture, so it reads the diagram as DSL text instead. For
 * example, `GET /api/v1/source?id=walkthrough-modules&section=m-review-map` answers that one
 * section as DSL.
 *
 * This file is the two Language routes: `language` answers the DSL's vocabulary, and `source`
 * prints one saved collection as DSL, whole or one section or object. Language does the printing
 * (source-readout.ts); this file never learns the DSL's rules.
 */
import type { ApiCall, RouteKey } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { Scope, Snapshot, StoredRecord } from '../../contract/records/capability-types.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { liveRecord } from '../workspace/records.js';
import { readSourceScope } from './source-scope.js';
import { readLastValue } from './api-query.js';
import { jsonRoute, type RouteHandler } from './route-answer.js';

/** A Language route, as `METHOD path`. */
export type SourceRouteKey = Extract<RouteKey, 'GET /api/v1/language' | 'GET /api/v1/source'>;

/** What the Language routes need from Language: its vocabulary, and a collection printed as DSL. */
export interface SourceReadout {
  /** Language's vocabulary, as Language answers it (its own `{ ok, value }`), sent on unchanged. */
  describe(): unknown;
  /**
   * Prints the stored collection (unchecked; Language checks it) as DSL for the scope. Answers
   * Language's readout (`source`, `collection`, `revision`, `scope`), sent on unchanged. Fails
   * with `invalid-input` at `source` when Language can't print it.
   */
  print(
    collection: unknown,
    scope: Scope,
  ): Result<unknown>;
}

/** What the Language routes call: the workspace session's `read`, and the readout. */
export interface SourceRouteDependencies {
  readonly session: Pick<WorkspaceSession, 'read'>;
  readonly source: SourceReadout;
}

/**
 * The two Language routes; both answer JSON. `language` never fails. `source` answers
 * `invalid-input` at `scope` for a bad `section` or `object`, `not-found` at `collection` when
 * `?id` names no saved collection, and the readout's print failure.
 */
export function sourceRoutes(
  dependencies: SourceRouteDependencies,
): Readonly<Record<SourceRouteKey, RouteHandler>> {
  return Object.freeze({
    'GET /api/v1/language': jsonRoute(async () => success(dependencies.source.describe())),
    'GET /api/v1/source': jsonRoute((call) => source(call, dependencies)),
  });
}

/**
 * One current collection printed as DSL for the `section` or `object` scope (all when neither).
 * Fails with `invalid-input` at `scope` as `readSourceScope` (source-scope.ts), and as
 * `readSourceRecord`.
 */
async function source(
  call: ApiCall,
  dependencies: SourceRouteDependencies,
): Promise<HttpOutcome> {
  const scope = readSourceScope(call.query);
  if (!scope.ok) return scope;
  return readSourceRecord(call, dependencies, scope.value);
}

/**
 * Reads the live collection named by `?id` and prints it without reinterpreting its shape;
 * Language validates it. Fails with `not-found` at `collection` when `?id` is missing or the
 * collection is absent or deleted. Authoring's read failures and the readout's `invalid-input`
 * at `source` pass through.
 */
async function readSourceRecord(
  call: ApiCall,
  dependencies: SourceRouteDependencies,
  scope: Scope,
): Promise<HttpOutcome> {
  const snapshot = await dependencies.session.read();
  if (!snapshot.ok) return snapshot;
  const record = sourceRecord(snapshot.value, readLastValue(call.query, 'id'));
  if (!record) return failure('not-found', 'collection', 'Collection was not found');
  return dependencies.source.print(record.value, scope);
}

/** The live collection record for `?id`; `undefined` when `?id` is missing or none is live. */
function sourceRecord(
  snapshot: Snapshot,
  id: string | undefined,
): StoredRecord | undefined {
  if (id === undefined) return undefined;
  return liveRecord(snapshot, 'collection', id);
}
