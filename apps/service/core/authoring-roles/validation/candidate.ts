/*
 * Authoring's candidate validator role: the mandatory final gate over a stamped candidate. Every
 * collection, preset, metadata and asset-admission record is checked against its owner and its
 * retained bytes. Pure over the injected owners; private typed throws stop at `validate`.
 * Authoring keeps the committed snapshot on rejection and owns scope, commit and recovery.
 */
import type {
  AuthoringResult,
  CandidateValidator,
  ReadVersion,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import type { ResourceSelector, WorkspaceReader } from '../../../contract/ports/workspace.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { authoringFailure } from '../../../contract/errors.js';
import { AdmissionFault, requireFact, requireRecord, requireRetention } from './admission-fault.js';
import { checkMetadata, checkPresets, type CatalogCheckOwners } from './catalog-checks.js';

/** What candidate validation reads; no validator can commit or alter the candidate it inspects. */
export interface CandidateValidatorOwners extends CatalogCheckOwners {
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  readonly resources: Pick<ResourceSelector, 'forCollection'>;
}

/**
 * Binds the validator. `validate` answers the read versions it consulted (history excluded), or:
 * - `invariant-violation` at `candidate` when a record is missing, a revision or retained byte
 *   manifest differs, metadata is invalid or names another workspace, or bytes are missing
 *   (the owner's failure kept as source where there is one);
 * - `corrupt-record` at `candidate` on any unexpected fault.
 * Reader failures pass through unchanged.
 */
export function createCandidateValidator(owners: CandidateValidatorOwners): CandidateValidator {
  return {
    async validate(before, after): Promise<AuthoringResult<readonly ReadVersion[]>> {
      try {
        return checked(before, after, owners);
      } catch (error) {
        return rejected(error);
      }
    },
  };
}

/**
 * Reads the candidate and checks its collections, then its presets and metadata (see
 * catalog-checks.ts), in that order. Answers the version of every record in `before` except
 * history. A failed check throws `AdmissionFault`, which `validate` turns into a failure (see
 * `rejected`). Reader failures pass through unchanged.
 */
function checked(
  before: Snapshot,
  after: Snapshot,
  owners: CandidateValidatorOwners,
): AuthoringResult<readonly ReadVersion[]> {
  const view = owners.workspace.read(after);
  if (!view.ok) return view;
  checkCollections(after, view.value, owners);
  checkPresets(after, view.value, owners);
  checkMetadata(after, view.value, owners);
  return {
    ok: true,
    value: before.records
      .filter((item) => item.key.kind !== 'history')
      .map((item) => ({ key: item.key, version: item.version })),
  };
}

/**
 * Checks each collection: its record exists at the collection's revision and retains exactly the
 * resources the selector expects. Throws `AdmissionFault` when the record is missing, the
 * revision or resources differ, or the selector fails (the selector's failure kept as source).
 */
function checkCollections(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CandidateValidatorOwners,
): void {
  view.collections.forEach((collection) => {
    const slot = requireRecord(snapshot, 'collection', collection.id);
    requireFact(
      slot.version === collection.revision,
      `Collection revision differs: ${collection.id}`,
    );
    const expected = owners.resources.forCollection(collection, view);
    if (!expected.ok) throw new AdmissionFault(expected.error.message, expected.error);
    requireRetention(slot, expected.value);
  });
}

/**
 * Turns a thrown fault into a failure: `AdmissionFault` is `invariant-violation` at `candidate`
 * (its source kept); anything else is `corrupt-record` at `candidate`.
 */
function rejected(error: unknown): AuthoringResult<never> {
  if (error instanceof AdmissionFault)
    return authoringFailure('invariant-violation', 'candidate', error.message, [], error.source);
  return authoringFailure(
    'corrupt-record',
    'candidate',
    'Candidate ownership validation could not complete',
  );
}
