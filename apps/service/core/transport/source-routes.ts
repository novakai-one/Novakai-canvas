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
import type { ApiCall, ApiQuery, RouteKey } from '../../contract/records/transport/protocol.js';
import type { HttpFailure, HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type { Snapshot, StoredRecord } from '../../contract/records/capability-types.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { failure, success, type Result } from '../../contract/errors.js';
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
    'GET /api/v1/language': jsonRoute(() => describeLanguage(dependencies.printer)),
    'GET /api/v1/source': jsonRoute((call) => printSource(call, dependencies)),
  });
}

/** Answers the DSL's vocabulary, as Language describes it. */
async function describeLanguage(printer: SourcePrinter): Promise<HttpOutcome> {
  const vocabulary = printer.describe();
  return success(vocabulary);
}

/**
 * Prints the `?id` collection as DSL, whole or just the `section` or `object` the query asks for.
 * Fails with `invalid-input` at `scope` as `readSourceScope` (source-scope.ts), and as
 * `readStoredCollection`; the printer's `invalid-input` at `source` passes through.
 */
async function printSource(
  call: ApiCall,
  dependencies: SourceRouteDependencies,
): Promise<HttpOutcome> {
  const scope = readSourceScope(call.query);
  if (!scope.ok) {
    return scope;
  }
  const collection = await readStoredCollection(call.query, dependencies.session);
  if (!collection.ok) {
    return collection;
  }
  return dependencies.printer.print(collection.value, scope.value);
}

/**
 * Reads the saved collection named by `?id`, as stored; Language checks its shape. Fails with
 * `not-found` at `collection` when `?id` is missing or the collection is absent or deleted.
 * Authoring's read failures pass through.
 */
async function readStoredCollection(
  query: ApiQuery,
  session: SourceRouteDependencies['session'],
): Promise<Result<unknown, HttpFailure>> {
  const snapshot = await session.read();
  if (!snapshot.ok) {
    return snapshot;
  }
  const id = readLastValue(query, 'id');
  const record = findCollectionRecord(snapshot.value, id);
  if (record === undefined) {
    return collectionNotFoundFailure();
  }
  return success(record.value);
}

/** Finds the live collection record for `?id`; none when `?id` is missing or none is live. */
function findCollectionRecord(
  snapshot: Snapshot,
  id: string | undefined,
): StoredRecord | undefined {
  if (id === undefined) {
    return undefined;
  }
  return findLiveRecord(snapshot, 'collection', id);
}

/** Makes the mistake for a `?id` that names no saved collection. */
function collectionNotFoundFailure(): Result<never> {
  return failure('not-found', 'collection', 'Collection was not found');
}
