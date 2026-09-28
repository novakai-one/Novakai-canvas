/*
 * Why this file exists
 *
 * An agent can't look at a diagram's picture, so it reads the diagram as DSL text instead. For
 * example, `GET /api/v1/source?id=walkthrough-modules&section=m-review-map` answers that one
 * section as DSL.
 *
 * This file is the two source routes: `language` answers the DSL's vocabulary, and `source` prints
 * one saved collection as DSL, whole or one section or object. The printer (source-printer.ts) does
 * the printing; this file never learns the DSL's rules. A mistake names the part of the request it
 * is about, such as `invalid-input` at `scope` (see `contract/errors.ts`).
 */
import type { ApiCall, RouteKey } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { Scope, Snapshot, StoredRecord } from '../../contract/records/capability-types.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { failure, success } from '../../contract/errors.js';
import { findLiveRecord } from '../workspace/records.js';
import type { SourcePrinter } from './source-printer.js';
import { readSourceScope } from './source-scope.js';
import { readLastValue } from './api-query.js';
import { jsonRoute, type RouteHandler } from './route-answer.js';

/** A source route, as `METHOD path`. */
export type SourceRouteKey = Extract<RouteKey, 'GET /api/v1/language' | 'GET /api/v1/source'>;

/** What the source routes call: the workspace session's `read`, and the printer. */
export interface SourceRouteDependencies {
  readonly session: Pick<WorkspaceSession, 'read'>;
  readonly printer: SourcePrinter;
}

/**
 * Builds the two source routes; both answer JSON. `language` never fails. `source` answers
 * `invalid-input` at `scope` for a bad `section` or `object`, `not-found` at `collection` when
 * `?id` names no saved collection, and the printer's failure.
 */
export function sourceRoutes(
  dependencies: SourceRouteDependencies,
): Readonly<Record<SourceRouteKey, RouteHandler>> {
  return Object.freeze({
    'GET /api/v1/language': jsonRoute(async () => success(dependencies.printer.describe())),
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
 * collection is absent or deleted. Authoring's read failures and the printer's `invalid-input`
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
  return dependencies.printer.print(record.value, scope);
}

/** The live collection record for `?id`; `undefined` when `?id` is missing or none is live. */
function sourceRecord(
  snapshot: Snapshot,
  id: string | undefined,
): StoredRecord | undefined {
  if (id === undefined) return undefined;
  return findLiveRecord(snapshot, 'collection', id);
}
