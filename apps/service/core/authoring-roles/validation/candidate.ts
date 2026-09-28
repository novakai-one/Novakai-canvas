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
  AuthoringResult,
  CandidateValidator,
  Collection,
  ReadVersion,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import type { AuthoringDigest } from '../../../contract/brands.js';
import type { ResourceSelector, WorkspaceReader } from '../../../contract/ports/workspace.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { andThen, success } from '../../../contract/errors.js';
import {
  checkMetadataRecords,
  checkPresets,
  type CatalogCheckDependencies,
} from './catalog-checks.js';
import {
  checkEach,
  invariantViolationFailure,
  requireFact,
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
  return { validate: async (before, after) => validate(before, after, dependencies) };
}

/**
 * Reads the candidate, checks it (see `checkCandidate`), then answers the version of every record
 * in `before` except undo/redo history records. Reader failures pass through unchanged.
 */
function validate(
  before: Snapshot,
  after: Snapshot,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<readonly ReadVersion[]> {
  const view = dependencies.workspace.read(after);
  if (!view.ok) return view;
  const checked = checkCandidate(after, view.value, dependencies);
  return andThen(checked, () => success(readVersions(before)));
}

/**
 * Checks the collections, then the presets, then the metadata (see catalog-checks.ts), in that
 * order; the first failure stops the checks.
 */
function checkCandidate(
  snapshot: Snapshot,
  view: WorkspaceContents,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<void> {
  const collections = checkCollections(snapshot, view, dependencies);
  const presets = andThen(collections, () => checkPresets(snapshot, view, dependencies));
  return andThen(presets, () => checkMetadataRecords(snapshot, view, dependencies));
}

/** The version of every record in `before` except undo/redo history records. Never fails. */
function readVersions(before: Snapshot): readonly ReadVersion[] {
  return before.records
    .filter((item) => item.key.kind !== 'history')
    .map((item) => ({ key: item.key, version: item.version }));
}

/**
 * Checks each collection in order (see `checkCollection`); the first failure stops the checks, so
 * later collections are not read through the selector.
 */
function checkCollections(
  snapshot: Snapshot,
  view: WorkspaceContents,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<void> {
  return checkEach(view.collections, (collection) =>
    checkCollection(snapshot, collection, view, dependencies),
  );
}

/**
 * Checks one collection: its record exists at the collection's revision and retains exactly the
 * resources the selector expects. Fails with `invariant-violation` at `candidate` when the record
 * is missing, the revision or resources differ, or the selector fails (see `expectedResources`).
 */
function checkCollection(
  snapshot: Snapshot,
  collection: Collection,
  view: WorkspaceContents,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<void> {
  const slot = requireRecord(snapshot, 'collection', collection.id);
  if (!slot.ok) return slot;
  const revision = requireFact(
    slot.value.version === collection.revision,
    `Collection revision differs: ${collection.id}`,
  );
  const expected = andThen(revision, () => expectedResources(collection, view, dependencies));
  return andThen(expected, (digests) => requireExactFiles(slot.value, digests));
}

/**
 * The digests the selector expects the collection to retain. Fails with `invariant-violation` at
 * `candidate` with the selector's message when it refuses (its failure kept as source).
 */
function expectedResources(
  collection: Collection,
  view: WorkspaceContents,
  dependencies: CandidateValidatorDependencies,
): AuthoringResult<readonly AuthoringDigest[]> {
  const expected = dependencies.resources.digestsForCollection(collection, view);
  if (!expected.ok) return invariantViolationFailure(expected.error.message, expected.error);
  return expected;
}
