/*
 * Authoring's candidate validator role: the mandatory final gate over a stamped candidate. Every
 * collection, preset, metadata and asset-admission record is checked against its owner and its
 * retained bytes. Pure over the injected owners; every check returns its refusal as a value and
 * the first one stops validation. Authoring keeps the committed snapshot on rejection and owns
 * scope, commit and recovery.
 */
import type {
  AuthoringResult,
  CandidateValidator,
  Collection,
  ReadVersion,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import type { AuthoringDigest } from '../../../contract/brands.js';
import type { ResourceSelector, WorkspaceReader } from '../../../contract/ports/workspace.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { andThen, success } from '../../../contract/errors.js';
import { checkMetadata, checkPresets, type CatalogCheckOwners } from './catalog-checks.js';
import {
  allPassed,
  invariantBroken,
  requireFact,
  requireRecord,
  requireRetention,
} from './record-checks.js';

/** What candidate validation reads; no validator can commit or alter the candidate it inspects. */
export interface CandidateValidatorOwners extends CatalogCheckOwners {
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  readonly resources: Pick<ResourceSelector, 'forCollection'>;
}

/**
 * Binds the validator. `validate` answers the read versions it consulted (history excluded), or
 * `invariant-violation` at `candidate` when a record is missing, a revision or retained byte
 * manifest differs, metadata is invalid or names another workspace, or bytes are missing (the
 * owner's failure kept as source where there is one). Reader failures pass through unchanged.
 */
export function createCandidateValidator(owners: CandidateValidatorOwners): CandidateValidator {
  return { validate: async (before, after) => validate(before, after, owners) };
}

/**
 * Reads the candidate, checks it (see `checkCandidate`), then answers the version of every record
 * in `before` except history. Reader failures pass through unchanged.
 */
function validate(
  before: Snapshot,
  after: Snapshot,
  owners: CandidateValidatorOwners,
): AuthoringResult<readonly ReadVersion[]> {
  const view = owners.workspace.read(after);
  if (!view.ok) return view;
  const checked = checkCandidate(after, view.value, owners);
  return andThen(checked, () => success(readVersions(before)));
}

/**
 * Checks the collections, then the presets, then the metadata (see catalog-checks.ts), in that
 * order; the first failure stops the checks.
 */
function checkCandidate(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CandidateValidatorOwners,
): AuthoringResult<void> {
  const collections = checkCollections(snapshot, view, owners);
  const presets = andThen(collections, () => checkPresets(snapshot, view, owners));
  return andThen(presets, () => checkMetadata(snapshot, view, owners));
}

/** The version of every record in `before` except history. Never fails. */
function readVersions(before: Snapshot): readonly ReadVersion[] {
  return before.records
    .filter((item) => item.key.kind !== 'history')
    .map((item) => ({ key: item.key, version: item.version }));
}

/** Checks each collection in order (see `checkCollection`). */
function checkCollections(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CandidateValidatorOwners,
): AuthoringResult<void> {
  return allPassed(
    view.collections.map((collection) => checkCollection(snapshot, collection, view, owners)),
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
  owners: CandidateValidatorOwners,
): AuthoringResult<void> {
  const slot = requireRecord(snapshot, 'collection', collection.id);
  if (!slot.ok) return slot;
  const revision = requireFact(
    slot.value.version === collection.revision,
    `Collection revision differs: ${collection.id}`,
  );
  const expected = andThen(revision, () => expectedResources(collection, view, owners));
  return andThen(expected, (digests) => requireRetention(slot.value, digests));
}

/**
 * The digests the selector expects the collection to retain. Fails with `invariant-violation` at
 * `candidate` with the selector's message when it refuses (its failure kept as source).
 */
function expectedResources(
  collection: Collection,
  view: WorkspaceContents,
  owners: CandidateValidatorOwners,
): AuthoringResult<readonly AuthoringDigest[]> {
  const expected = owners.resources.forCollection(collection, view);
  if (!expected.ok) return invariantBroken(expected.error.message, expected.error);
  return expected;
}
