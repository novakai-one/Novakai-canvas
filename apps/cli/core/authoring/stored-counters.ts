/*
 * Why this file exists
 *
 * A stored collection has two counters, and a change needs both. Its storage version is
 * Authoring's count of writes to the record; the change sends it, so a stale write fails. Its
 * revision is Model's count of saved changes; `--revision 3` must match it.
 *
 * This file reads both counters off one stored collection, once Model accepts the collection. They
 * come from the service, so a bad counter is the service's mistake. It never compares them with
 * `--revision`; `change-request.ts` does.
 */
import type { CollectionValidator } from '../../contract/ports/collection-validator.js';
import type { Collection, FailureSource, StoredRecord } from '../../contract/records/foreign.js';
import type { CollectionRevision, StorageVersion } from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { collectionRevision, storageVersion } from '../../contract/brands.js';
import { evidenced, failure, success } from '../../contract/errors.js';

/** A stored collection's two counters, each checked once. */
export interface CollectionCounters {
  /** Authoring's storage version: the precondition the change sends. */
  readonly version: StorageVersion;
  /** Model's revision: what the agent's `--revision` must match. */
  readonly revision: CollectionRevision;
}

/**
 * Reads the storage version and the revision of the collection stored in `stored`.
 * The mistakes it can find, all `invalid-response`: Model rejects the stored collection (Model's
 * reasons are kept), or a counter isn't a whole number.
 */
export function readStoredCounters(
  stored: StoredRecord,
  validator: CollectionValidator,
): Result<CollectionCounters> {
  const collection = validator.validate(stored.value);
  if (!collection.ok) {
    return invalidStoredCollectionFailure(collection.error);
  }
  return checkCounters(stored, collection.value);
}

/** Checks the storage version and the revision are whole numbers, and gives them their brands. */
function checkCounters(
  stored: StoredRecord,
  collection: Collection,
): Result<CollectionCounters> {
  const version = storageVersion.safeParse(stored.version);
  if (!version.success) {
    return invalidStoredVersionFailure();
  }
  const revision = collectionRevision.safeParse(collection.revision);
  if (!revision.success) {
    return invalidStoredRevisionFailure();
  }
  const counters: CollectionCounters = { version: version.data, revision: revision.data };
  return success(counters);
}

/** Makes the mistake for a stored collection Model rejects, keeping Model's reasons. */
function invalidStoredCollectionFailure(modelReasons: FailureSource): Result<never, LocalFailure> {
  return evidenced({
    code: 'invalid-response',
    message: 'The collection is not a valid Model document',
    recovery: 'Correct the named Model diagnostics.',
    source: modelReasons,
  });
}

/** Makes the mistake for a stored storage version that isn't a whole number. */
function invalidStoredVersionFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: 'The stored collection has an invalid storage version',
  });
}

/** Makes the mistake for a stored revision that isn't a whole number, 0 or more. */
function invalidStoredRevisionFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: 'The stored collection has an invalid revision',
  });
}
