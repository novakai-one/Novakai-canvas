/*
 * Why this file exists
 *
 * A change must never overwrite work the agent hasn't seen. `replace plan.canvas --revision 3` may
 * go ahead only while the collection is still at revision 3. `create` may go ahead only while no
 * collection has that ID, not even a deleted one.
 *
 * This file builds the Authoring request for one change. The request says what it expects to find,
 * so Authoring refuses it if the workspace has moved on. It never sends anything. Each step gives
 * back a `Result` (see `contract/errors.ts`), and the mistakes are made here.
 */
import type { CollectionValidator } from '../../contract/ports/collection-validator.js';
import type { ChangeIntent } from '../../contract/records/command.js';
import type {
  ReadVersion,
  AuthoringRequest,
  WorkspaceSnapshot,
  StoredRecord,
} from '../../contract/records/foreign.js';
import type {
  CollectionRevision,
  RecordId,
  RequestId,
  StorageVersion,
  WorkspaceId,
} from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { recordId } from '../../contract/brands.js';
import { failure, invalidInputFailure, success } from '../../contract/errors.js';
import { buildAuthoringRequest } from './envelope.js';
import type { AuthoringRequestDraft, PlannedChange, SourceChange } from './envelope.js';
import { readStoredCounters } from './stored-counters.js';
import type { CollectionCounters } from './stored-counters.js';

/** One change from a source file, before it is checked against the workspace. */
export interface ChangeDraft {
  /** Create, replace or patch, with the revision the agent read for the last two. */
  readonly intent: ChangeIntent;
  /** The collection the source declares, from {@link checkCollectionRecordId}. */
  readonly collection: RecordId;
  /** The source file's text, sent unchanged. */
  readonly source: string;
  /** The ID the change is sent under. */
  readonly request: RequestId;
}

/**
 * Checks the collection ID a source declares can be stored as an Authoring record ID.
 * `declaredId` is the ID as Language read it from the source, such as `commerce`.
 * The mistake it can find: an ID over 128 characters (`invalid-input` for `create`, `not-found`
 * for `replace` and `patch`, since nothing can be stored under it).
 */
export function checkCollectionRecordId(
  intent: ChangeIntent,
  declaredId: string,
): Result<RecordId> {
  const id = recordId.safeParse(declaredId);
  if (!id.success) {
    return unstorableIdFailure(intent);
  }
  return success(id.data);
}

/**
 * Builds the Authoring request for one change, checked against `snapshot`, the workspace as read.
 * The mistakes it can find: no such collection (`not-found`), one already there (`already-exists`),
 * a missing or old `--revision` (`revision-required`, `revision-conflict`), a broken stored
 * workspace (`invalid-response`), or a request that fails Authoring's check (`invalid-input`).
 */
export function buildChangeRequest(
  draft: ChangeDraft,
  snapshot: WorkspaceSnapshot,
  validator: CollectionValidator,
): Result<AuthoringRequest> {
  const stored = findCollectionRecord(snapshot, draft.collection);
  const version = expectedVersion(draft.intent, stored, validator);
  if (!version.ok) {
    return version;
  }
  const catalog = findLiveCatalog(snapshot);
  if (!catalog.ok) {
    return catalog;
  }
  const expected = listPreconditions(draft, version.value, catalog.value);
  const requestDraft = draftChangeRequest(draft, snapshot.workspace, expected);
  return buildAuthoringRequest(requestDraft, invalidInputFailure());
}

/** Finds the record stored under the collection's ID, even a deleted collection's. */
function findCollectionRecord(
  snapshot: WorkspaceSnapshot,
  id: RecordId,
): StoredRecord | undefined {
  return snapshot.records.find((record) => isCollectionRecord(record, id));
}

/** Whether the record is the collection record `id`. */
function isCollectionRecord(
  record: StoredRecord,
  id: RecordId,
): boolean {
  return record.key.kind === 'collection' && record.key.id === id;
}

/** Works out the version the change expects the collection's record at: `absent` for `create`. */
function expectedVersion(
  intent: ChangeIntent,
  stored: StoredRecord | undefined,
  validator: CollectionValidator,
): Result<ReadVersion['version']> {
  if (intent.mode === 'create') {
    return versionForCreate(stored);
  }
  return storedVersion(stored, intent.revision, validator);
}

/**
 * Checks nothing is stored under the ID, so a deleted collection is never silently brought back.
 */
function versionForCreate(stored: StoredRecord | undefined): Result<ReadVersion['version']> {
  if (stored !== undefined) {
    return alreadyExistsFailure();
  }
  return success('absent');
}

/** Finds the stored record's version, once its revision matches the one the agent read. */
function storedVersion(
  stored: StoredRecord | undefined,
  requested: CollectionRevision | undefined,
  validator: CollectionValidator,
): Result<StorageVersion> {
  if (stored === undefined) {
    return missingCollectionFailure();
  }
  const counters = readStoredCounters(stored, validator);
  if (!counters.ok) {
    return counters;
  }
  return matchRevision(counters.value, requested);
}

/**
 * Gives back the storage version when the agent read the current revision; a missing `--revision`
 * is never permission to overwrite newer work.
 */
function matchRevision(
  counters: CollectionCounters,
  requested: CollectionRevision | undefined,
): Result<StorageVersion> {
  if (requested === undefined) {
    return revisionRequiredFailure();
  }
  if (requested !== counters.revision) {
    return revisionConflictFailure(requested, counters.revision);
  }
  return success(counters.version);
}

/**
 * Finds the workspace's live catalog record, which every change needs, even a `replace`.
 * The mistake it can find: no catalog, or only a deleted one (`invalid-response`).
 */
function findLiveCatalog(snapshot: WorkspaceSnapshot): Result<StoredRecord> {
  const catalog = snapshot.records.find(isLiveCatalog);
  if (catalog === undefined) {
    return missingCatalogFailure();
  }
  return success(catalog);
}

/** Whether the record is the workspace's catalog, and not deleted. */
function isLiveCatalog(record: StoredRecord): boolean {
  return record.key.kind === 'catalog' && !record.deleted;
}

/**
 * Lists each record the change expects at the version read: the collection, and for `create` the
 * catalog too, so the new collection is registered in the same save.
 */
function listPreconditions(
  draft: ChangeDraft,
  version: ReadVersion['version'],
  catalog: StoredRecord,
): readonly ReadVersion[] {
  const collectionVersion: ReadVersion = {
    key: { kind: 'collection', id: draft.collection },
    version,
  };
  if (draft.intent.mode === 'create') {
    const catalogVersion: ReadVersion = { key: catalog.key, version: catalog.version };
    return [collectionVersion, catalogVersion];
  }
  return [collectionVersion];
}

/** Puts together the parts of the change request that `buildAuthoringRequest` is given. */
function draftChangeRequest(
  draft: ChangeDraft,
  workspace: WorkspaceId,
  expected: readonly ReadVersion[],
): AuthoringRequestDraft {
  const sourceChange: SourceChange = { source: draft.source, mode: draft.intent.mode };
  const change: PlannedChange = { planner: 'dsl', payload: sourceChange };
  return { workspace, request: draft.request, expected, assets: [], change };
}

/** Makes the mistake for a declared ID that can't be stored: `invalid-input` or `not-found`. */
function unstorableIdFailure(intent: ChangeIntent): Result<never, LocalFailure> {
  if (intent.mode === 'create') {
    return invalidInputFailure();
  }
  return missingCollectionFailure();
}

/** Makes the mistake for `replace` or `patch` of a collection that isn't stored (`not-found`). */
function missingCollectionFailure(): Result<never, LocalFailure> {
  return failure({ code: 'not-found', message: 'The collection does not exist' });
}

/** Makes the mistake for `create` of an ID a record is already stored under (`already-exists`). */
function alreadyExistsFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'already-exists',
    message: 'Collection identity already exists; choose a new collection ID',
  });
}

/** Makes the mistake for `replace` or `patch` typed without `--revision` (`revision-required`). */
function revisionRequiredFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'revision-required',
    message: 'Editing requires --revision from canvas read',
  });
}

/** Makes the mistake for a `--revision` that isn't the stored one (`revision-conflict`). */
function revisionConflictFailure(
  requested: CollectionRevision,
  current: CollectionRevision,
): Result<never, LocalFailure> {
  return failure({
    code: 'revision-conflict',
    message: `Read revision ${requested} differs from current revision ${current}`,
    recovery: 'Read the collection and compare changes before submitting a new request.',
  });
}

/** Makes the mistake for a workspace with no live catalog record (`invalid-response`). */
function missingCatalogFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-response', message: 'Workspace catalog is missing' });
}
