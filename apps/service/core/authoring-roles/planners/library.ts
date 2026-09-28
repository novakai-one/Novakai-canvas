/*
 * Why this file exists
 *
 * People sort their diagrams into folders in the catalog. For example, making a folder in the
 * browser sends a `library` change holding `{ op: 'create-folder', value }`. That changes the
 * catalog only, never a diagram.
 *
 * This file is the `library` planner. It asks Library to apply the batch to the stored catalog, and
 * plans one write of the new catalog. The save is refused if any collection or the catalog changed
 * in the meantime. It only plans; Authoring saves.
 */
import type {
  AuthoringResult,
  IntentPlanner,
  Organisation,
  Proposal,
  ReadVersion,
  Request,
  Snapshot,
  StoredRecord,
} from '../../../contract/records/capability-types.js';
import type { LibraryRules } from '../../../contract/ports/capabilities.js';
import type { WorkspaceReader } from '../../../contract/ports/workspace.js';
import { libraryCommand } from '../../../contract/records/planning/commands.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure, success } from '../../../contract/errors.js';
import { listLiveRecords } from '../../workspace/records.js';
import { readChangePayload, checkProposal, capabilityRefusalFailure } from './change-payload.js';

/** What the `library` planner needs. */
export interface LibraryPlannerDependencies {
  /** Library's rules. Applies a batch of catalog changes. */
  readonly library: Pick<LibraryRules, 'planOrganisation'>;
  /** Reads the snapshot into the checked catalog. */
  readonly workspace: Pick<WorkspaceReader, 'read'>;
}

/**
 * Builds the `library` planner. Its `plan` applies a batch of catalog changes and answers the
 * planned catalog write. Mistakes: `invalid-input` when the request isn't a change or its batch is
 * malformed, or `invariant-violation` at `catalog` when Library refuses the batch or no catalog is
 * stored. The reader's pass through.
 */
export function createLibraryPlanner(dependencies: LibraryPlannerDependencies): IntentPlanner {
  return {
    id: plannerId.parse('library'),
    plan: async (request, snapshot) => planLibraryChange(request, snapshot, dependencies),
  };
}

/** Reads the batch of catalog changes, has Library apply it, then plans the catalog's write. */
function planLibraryChange(
  request: Request,
  snapshot: Snapshot,
  dependencies: LibraryPlannerDependencies,
): AuthoringResult<Proposal> {
  const changes = readCatalogChanges(request);
  if (!changes.ok) {
    return changes;
  }
  const organisation = planCatalog(changes.value, snapshot, dependencies);
  if (!organisation.ok) {
    return organisation;
  }
  return proposeCatalogWrite(organisation.value, snapshot);
}

/** Takes the batch of catalog changes out of the request. */
function readCatalogChanges(request: Request): AuthoringResult<readonly unknown[]> {
  const payload = readChangePayload(request, 'intent', 'Expected a library change');
  if (!payload.ok) {
    return payload;
  }
  const command = libraryCommand.safeParse(payload.value);
  if (!command.success) {
    return malformedBatchFailure();
  }
  return success(command.data.changes);
}

/** Has Library apply the batch to the stored catalog, and gives the new catalog. */
function planCatalog(
  changes: readonly unknown[],
  snapshot: Snapshot,
  dependencies: LibraryPlannerDependencies,
): AuthoringResult<Organisation> {
  const contents = dependencies.workspace.read(snapshot);
  if (!contents.ok) {
    return contents;
  }
  const planned = dependencies.library.planOrganisation({
    snapshot: contents.value.library,
    changes,
  });
  if (!planned.ok) {
    return capabilityRefusalFailure('invariant-violation', 'catalog', planned.error);
  }
  return success(planned.value.candidate);
}

/**
 * Plans one write of the new catalog over the stored one. Every collection and catalog version is
 * listed as read, so Authoring refuses the save if any of them changed in the meantime.
 */
function proposeCatalogWrite(
  organisation: Organisation,
  snapshot: Snapshot,
): AuthoringResult<Proposal> {
  const storedCatalog = findStoredCatalog(snapshot);
  if (storedCatalog === undefined) {
    return missingCatalogFailure();
  }
  const catalogWrite = { kind: 'put', key: storedCatalog.key, value: organisation, resources: [] };
  const reads = listCollectionAndCatalogVersions(snapshot);
  const planned = {
    writes: [catalogWrite],
    reads,
    diff: { kind: 'library-organisation' },
    warnings: [],
  };
  return checkProposal(planned, 'catalog', 'Library proposal could not be admitted');
}

/** Finds the stored catalog record, if there is one. */
function findStoredCatalog(snapshot: Snapshot): StoredRecord | undefined {
  const catalogs = listLiveRecords(snapshot, 'catalog');
  return catalogs[0];
}

/** Lists the version of every collection and catalog record in the snapshot. */
function listCollectionAndCatalogVersions(snapshot: Snapshot): readonly ReadVersion[] {
  const collectionAndCatalogRecords = snapshot.records.filter(isCollectionOrCatalog);
  return collectionAndCatalogRecords.map((record) => ({
    key: record.key,
    version: record.version,
  }));
}

/** Whether the record is a collection or the catalog. */
function isCollectionOrCatalog(record: StoredRecord): boolean {
  return record.key.kind === 'collection' || record.key.kind === 'catalog';
}

/** Makes the mistake for a library change whose batch is missing or too long. */
function malformedBatchFailure(): AuthoringResult<never> {
  return authoringFailure(
    'invalid-input',
    'library',
    'Library changes require a bounded change batch',
  );
}

/** Makes the mistake for a workspace with no stored catalog. */
function missingCatalogFailure(): AuthoringResult<never> {
  return authoringFailure('invariant-violation', 'catalog', 'A library catalog is required');
}
