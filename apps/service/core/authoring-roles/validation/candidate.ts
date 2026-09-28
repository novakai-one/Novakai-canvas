/*
 * Why this file exists
 *
 * A planner only plans writes. Before Authoring saves them, the whole workspace as it would look
 * afterwards (the "candidate") gets one last check. For example, if a saved theme's font file were
 * missing from storage, the check would refuse the change and nothing would be saved.
 *
 * This file builds that check (`CandidateValidator`). It checks each collection here, then the
 * presets and the other records (catalog-checks.ts). Each check answers a `Result`
 * (contract/errors.ts), and the first mistake stops it. It never changes the candidate.
 */
import type {
  AuthoringDiagnostic,
  AuthoringResult,
  CandidateValidator,
  Collection,
  ReadVersion,
  Snapshot,
  StoredRecord,
} from '../../../contract/records/capability-types.js';
import type { AuthoringDigest } from '../../../contract/brands.js';
import type { ResourceSelector, WorkspaceReader } from '../../../contract/ports/workspace.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { success } from '../../../contract/errors.js';
import {
  checkMetadataRecords,
  checkPresets,
  type CatalogCheckDependencies,
} from './catalog-checks.js';
import {
  checkEach,
  invariantViolationFailure,
  requireRecord,
  requireExactFiles,
} from './record-checks.js';

/** What the final check reads. Nothing here can save or change the candidate. */
export interface CandidateValidatorDependencies extends CatalogCheckDependencies {
  /** Reads the candidate into checked collections, catalog and presets. */
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  /** Works out which stored files each collection needs. */
  readonly resources: Pick<ResourceSelector, 'digestsForCollection'>;
}

/**
 * Builds the final check (`CandidateValidator`). Its `validate` checks the workspace as the change
 * would leave it, and answers the version each record it read had before the change. Authoring
 * saves only if those versions are still current. Undo and redo records aren't in that list;
 * Authoring guards those itself.
 * Mistakes: `invariant-violation` at `candidate` when a record is missing or out of date, keeps the
 * wrong files, names another workspace, or a file is gone. Reader mistakes pass through.
 */
export function createCandidateValidator(
  dependencies: CandidateValidatorDependencies,
): CandidateValidator {
  return { validate: async (before, after) => validateCandidate(before, after, dependencies) };
}

/** Reads and checks the candidate, then lists the versions the save depends on. */
function validateCandidate(
  before: Snapshot,
  after: Snapshot,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<readonly ReadVersion[]> {
  const contents = dependencies.workspace.read(after);
  if (!contents.ok) {
    return contents;
  }
  const checked = checkCandidate(after, contents.value, dependencies);
  if (!checked.ok) {
    return checked;
  }
  const versions = listReadVersions(before);
  return success(versions);
}

/** Checks the collections, then the presets, then the other records; the first mistake stops it. */
function checkCandidate(
  snapshot: Snapshot,
  contents: WorkspaceContents,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<void> {
  const collections = checkCollections(snapshot, contents, dependencies);
  if (!collections.ok) {
    return collections;
  }
  const presets = checkPresets(snapshot, contents, dependencies);
  if (!presets.ok) {
    return presets;
  }
  return checkMetadataRecords(snapshot, contents, dependencies);
}

/** Lists the version of every record before the change, leaving out undo and redo records. */
function listReadVersions(before: Snapshot): readonly ReadVersion[] {
  const nonHistoryRecords = before.records.filter((record) => record.key.kind !== 'history');
  return nonHistoryRecords.map((record) => ({ key: record.key, version: record.version }));
}

/** Checks each collection in order; the first mistake stops the checks. */
function checkCollections(
  snapshot: Snapshot,
  contents: WorkspaceContents,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<void> {
  return checkEach(contents.collections, (collection) =>
    checkCollection(snapshot, collection, contents, dependencies),
  );
}

/** Checks one collection's record is current and keeps exactly the files the collection needs. */
function checkCollection(
  snapshot: Snapshot,
  collection: Collection,
  contents: WorkspaceContents,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<void> {
  const record = requireCurrentRecord(snapshot, collection);
  if (!record.ok) {
    return record;
  }
  const expectedDigests = listExpectedFiles(collection, contents, dependencies);
  if (!expectedDigests.ok) {
    return expectedDigests;
  }
  return requireExactFiles(record.value, expectedDigests.value);
}

/** Finds the collection's record, and checks it is at the collection's revision. */
function requireCurrentRecord(
  snapshot: Snapshot,
  collection: Collection,
): AuthoringResult<StoredRecord> {
  const record = requireRecord(snapshot, 'collection', collection.id);
  if (!record.ok) {
    return record;
  }
  if (record.value.version !== collection.revision) {
    return collectionRevisionFailure(collection);
  }
  return success(record.value);
}

/** Asks the selector which stored files the collection needs. */
function listExpectedFiles(
  collection: Collection,
  contents: WorkspaceContents,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<readonly AuthoringDigest[]> {
  const expectedDigests = dependencies.resources.digestsForCollection(collection, contents);
  if (!expectedDigests.ok) {
    return selectorRefusalFailure(expectedDigests.error);
  }
  return success(expectedDigests.value);
}

/** Makes the mistake for a collection record that isn't at the collection's revision. */
function collectionRevisionFailure(collection: Collection): AuthoringResult<never> {
  return invariantViolationFailure(`Collection revision differs: ${collection.id}`);
}

/** Makes the mistake for a collection whose files the selector refused, keeping its reason. */
function selectorRefusalFailure(selectorMistake: AuthoringDiagnostic): AuthoringResult<never> {
  return invariantViolationFailure(selectorMistake.message, selectorMistake);
}
