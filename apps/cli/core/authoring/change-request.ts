/*
 * The Authoring request of one DSL change, with preconditions read from the snapshot the change
 * was prepared from. Pure apart from the injected Model check. `create` needs the collection
 * absent (a deleted one still counts as present) and also expects the catalog; `replace` and
 * `patch` need the revision the agent read. Nothing is sent; the caller fixes the named input and
 * runs the command again.
 */
import type { CollectionReader } from '../../contract/ports/collection-reader.js';
import type { ChangeIntent } from '../../contract/records/command.js';
import type { Request, Snapshot, StoredRecord } from '../../contract/records/foreign.js';
import type { CollectionRevision, RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure, malformedRequest, success } from '../../contract/errors.js';
import { envelope } from './envelope.js';
import type { Precondition } from './envelope.js';

/** One DSL change, before its preconditions are read from the snapshot. */
export interface ChangeDraft {
  readonly intent: ChangeIntent;
  /** The collection ID the source declares, as Language parsed it. */
  readonly collection: string;
  /** The DSL source; sent unchanged in the payload. */
  readonly source: string;
  readonly request: RequestId;
}

/**
 * The change's Authoring request. Fails with `not-found`, `already-exists`, `revision-required`,
 * `revision-conflict`, `invalid-response` (the stored collection fails Model's check, or the
 * snapshot has no catalog) or `invalid-input` (the request fails Authoring's schema).
 */
export function changeRequest(
  draft: ChangeDraft,
  snapshot: Snapshot,
  reader: CollectionReader,
): Result<Request> {
  const record = snapshot.records.find(
    (item) => item.key.kind === 'collection' && item.key.id === draft.collection,
  );
  const version = expectedVersion(draft.intent, record, reader);
  if (!version.ok) return version;
  return withCatalog(draft, snapshot, version.value);
}

/**
 * `create` needs no record under the ID, so a deleted collection is never silently brought back;
 * `replace` and `patch` need the stored revision. Fails with `already-exists` or as
 * {@link storedVersion} does.
 */
function expectedVersion(
  intent: ChangeIntent,
  record: StoredRecord | undefined,
  reader: CollectionReader,
): Result<Precondition['version']> {
  if (intent.mode !== 'create') return storedVersion(record, intent.revision, reader);
  if (record !== undefined)
    return failure({
      code: 'already-exists',
      message: 'Collection identity already exists; choose a new collection ID',
    });
  return success('absent');
}

/**
 * The record's storage version, once its Model revision matches the one the agent read. Fails
 * with `not-found`, `invalid-response` (Model rejects the stored collection; its diagnostics are
 * kept) or as {@link matchedRevision} does.
 */
function storedVersion(
  record: StoredRecord | undefined,
  requested: CollectionRevision | undefined,
  reader: CollectionReader,
): Result<number> {
  if (record === undefined)
    return failure({ code: 'not-found', message: 'The collection does not exist' });
  const collection = reader.validate(record.value);
  if (!collection.ok)
    return failure({
      code: 'invalid-response',
      message: 'The collection is not a valid Model document',
      recovery: 'Correct the named Model diagnostics.',
      source: collection.error,
    });
  return matchedRevision(record.version, collection.value.revision, requested);
}

/**
 * `version` when the agent read the current revision. A missing revision is never permission to
 * overwrite newer work. Fails with `revision-required` or `revision-conflict`.
 */
function matchedRevision(
  version: number,
  current: number,
  requested: CollectionRevision | undefined,
): Result<number> {
  if (requested === undefined)
    return failure({
      code: 'revision-required',
      message: 'Editing requires --revision from canvas read',
    });
  if (requested !== current)
    return failure({
      code: 'revision-conflict',
      message: `Read revision ${requested} differs from current revision ${current}`,
      recovery: 'Read the collection and compare changes before submitting a new request.',
    });
  return success(version);
}

/**
 * The checked request. Every change needs the live catalog in the snapshot; only `create` expects
 * it, so the new collection registers in the same transaction. Fails with `invalid-response` (no
 * catalog) or `invalid-input`.
 */
function withCatalog(
  draft: ChangeDraft,
  snapshot: Snapshot,
  version: Precondition['version'],
): Result<Request> {
  const catalog = snapshot.records.find((item) => item.key.kind === 'catalog' && !item.deleted);
  if (catalog === undefined)
    return failure({ code: 'invalid-response', message: 'Workspace catalog is missing' });
  const collection: Precondition = { key: { kind: 'collection', id: draft.collection }, version };
  const expected = preconditions(draft.intent, collection, catalog);
  return envelope(
    {
      workspace: snapshot.workspace,
      request: draft.request,
      expected,
      assets: [],
      planner: 'dsl',
      payload: { source: draft.source, mode: draft.intent.mode },
    },
    malformedRequest,
  );
}

/** The collection's precondition, then the catalog's for `create`. */
function preconditions(
  intent: ChangeIntent,
  collection: Precondition,
  catalog: StoredRecord,
): readonly Precondition[] {
  if (intent.mode !== 'create') return [collection];
  return [collection, { key: catalog.key, version: catalog.version }];
}
