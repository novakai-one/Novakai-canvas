/*
 * The Authoring request of one DSL change, with preconditions read from the snapshot the change
 * was prepared from. Pure apart from the injected Model check. The source's collection ID becomes
 * an Authoring record ID once, here; the stored record's storage version and its collection's
 * Model revision are branded once, here. `create` needs the collection absent (a deleted one still
 * counts as present) and also expects the catalog; `replace` and `patch` need the revision the
 * agent read. Nothing is sent; the caller fixes the named input and runs the command again.
 */
import type { CollectionValidator } from '../../contract/ports/collection-validator.js';
import type { ChangeIntent } from '../../contract/records/command.js';
import type {
  Collection,
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
} from '../../contract/brands.js';
import type { FailureInput, LocalFailure, Result } from '../../contract/errors.js';
import { collectionRevision, recordId, storageVersion } from '../../contract/brands.js';
import { failure, invalidInputFailure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import { envelope } from './envelope.js';

/** One DSL change, before its preconditions are read from the snapshot. */
export interface ChangeDraft {
  readonly intent: ChangeIntent;
  /** The collection the source declares, from {@link collectionRecordId}. */
  readonly collection: RecordId;
  /** The DSL source; sent unchanged in the payload. */
  readonly source: string;
  readonly request: RequestId;
}

/** `replace` or `patch` of a collection no record is stored under. */
const missingCollection: FailureInput = Object.freeze({
  code: 'not-found',
  message: 'The collection does not exist',
});

/** A stored collection record whose storage version is not Authoring's whole number. */
const invalidStoredVersion: FailureInput = Object.freeze({
  code: 'invalid-response',
  message: 'The stored collection has an invalid storage version',
});

/** A stored collection whose Model revision is not a whole number, 0 or more. */
const invalidStoredRevision: FailureInput = Object.freeze({
  code: 'invalid-response',
  message: 'The stored collection has an invalid revision',
});

/** A stored collection's two counters, each checked once. */
interface CollectionCounters {
  /** Authoring's storage version: the precondition the change sends. */
  readonly version: StorageVersion;
  /** Model's revision: what the agent's `--revision` must match. */
  readonly revision: CollectionRevision;
}

/**
 * The collection ID Language parsed, as an Authoring record ID. An ID Authoring cannot store (over
 * 128 characters) names no stored collection: fails with `not-found` for `replace` and `patch`,
 * and `invalid-input` for `create`.
 */
export function collectionRecordId(
  intent: ChangeIntent,
  text: string,
): Result<RecordId> {
  const id = recordId.safeParse(text);
  if (!id.success) return unstorableIdFailure(intent);
  return success(id.data);
}

/** `invalid-input` for `create`; `not-found` for `replace` and `patch`, as no record is stored. */
function unstorableIdFailure(intent: ChangeIntent): Result<never, LocalFailure> {
  if (intent.mode === 'create') return invalidInputFailure();
  return failure(missingCollection);
}

/**
 * The change's Authoring request. Fails with `not-found`, `already-exists`, `revision-required`,
 * `revision-conflict`, `invalid-response` (the stored collection fails Model's check, a stored
 * counter is not a whole number, or the snapshot has no catalog) or `invalid-input` (the request
 * fails Authoring's schema).
 */
export function changeRequest(
  draft: ChangeDraft,
  snapshot: WorkspaceSnapshot,
  reader: CollectionValidator,
): Result<AuthoringRequest> {
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
  reader: CollectionValidator,
): Result<ReadVersion['version']> {
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
 * with `not-found`, as {@link countersOf} does, or as {@link matchedRevision} does.
 */
function storedVersion(
  record: StoredRecord | undefined,
  requested: CollectionRevision | undefined,
  reader: CollectionValidator,
): Result<StorageVersion> {
  if (record === undefined) return failure(missingCollection);
  const counters = countersOf(record, reader);
  if (!counters.ok) return counters;
  return matchedRevision(counters.value.version, counters.value.revision, requested);
}

/**
 * The record's storage version and its collection's Model revision, each minted here. Fails with
 * `invalid-response`: Model rejects the stored collection (its diagnostics are kept), or a counter
 * is not a whole number.
 */
function countersOf(
  record: StoredRecord,
  reader: CollectionValidator,
): Result<CollectionCounters> {
  const collection = reader.validate(record.value);
  if (!collection.ok)
    return failure({
      code: 'invalid-response',
      message: 'The collection is not a valid Model document',
      recovery: 'Correct the named Model diagnostics.',
      source: collection.error,
    });
  return mintedCounters(record, collection.value);
}

/**
 * The record's storage version and the collection's revision, as their brands. Fails with
 * `invalid-response` when either is not a whole number.
 */
function mintedCounters(
  record: StoredRecord,
  collection: Collection,
): Result<CollectionCounters> {
  const version = checked(storageVersion, record.version, invalidStoredVersion);
  if (!version.ok) return version;
  const revision = checked(collectionRevision, collection.revision, invalidStoredRevision);
  if (!revision.ok) return revision;
  return success({ version: version.value, revision: revision.value });
}

/**
 * `version` when the agent read the current revision. A missing revision is never permission to
 * overwrite newer work. Fails with `revision-required` or `revision-conflict`.
 */
function matchedRevision(
  version: StorageVersion,
  current: CollectionRevision,
  requested: CollectionRevision | undefined,
): Result<StorageVersion> {
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
  snapshot: WorkspaceSnapshot,
  version: ReadVersion['version'],
): Result<AuthoringRequest> {
  const catalog = snapshot.records.find((item) => item.key.kind === 'catalog' && !item.deleted);
  if (catalog === undefined)
    return failure({ code: 'invalid-response', message: 'Workspace catalog is missing' });
  const collection: ReadVersion = { key: { kind: 'collection', id: draft.collection }, version };
  const expected = preconditions(draft.intent, collection, catalog);
  return envelope(
    {
      workspace: snapshot.workspace,
      request: draft.request,
      expected,
      assets: [],
      change: { planner: 'dsl', payload: { source: draft.source, mode: draft.intent.mode } },
    },
    invalidInputFailure(),
  );
}

/** The collection's precondition, then the catalog's for `create`. */
function preconditions(
  intent: ChangeIntent,
  collection: ReadVersion,
  catalog: StoredRecord,
): readonly ReadVersion[] {
  if (intent.mode !== 'create') return [collection];
  return [collection, { key: catalog.key, version: catalog.version }];
}
