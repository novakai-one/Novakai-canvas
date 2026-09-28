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
  Proposal,
  Request,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import type { LibraryRules } from '../../../contract/ports/capabilities.js';
import type { WorkspaceReader } from '../../../contract/ports/workspace.js';
import { libraryCommand } from '../../../contract/records/planning/commands.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';
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
    plan: async (request, snapshot) => propose(request, snapshot, dependencies),
  };
}

/**
 * The `library` planner: decodes the change batch, then plans it (see `planOrganisationChange`).
 * Fails with `invalid-input` at `intent` when the request is not a change, and at `library` when
 * the payload is not a bounded change batch.
 */
function propose(
  request: Request,
  snapshot: Snapshot,
  dependencies: LibraryPlannerDependencies,
): AuthoringResult<Proposal> {
  const input = readChangePayload(request, 'intent', 'Expected a library change');
  if (!input.ok) return input;
  const command = libraryCommand.safeParse(input.value);
  if (!command.success)
    return authoringFailure(
      'invalid-input',
      'library',
      'Library changes require a bounded change batch',
    );
  return planOrganisationChange(command.data.changes, snapshot, dependencies);
}

/**
 * Plans the batch on the stored catalog through Library, then proposes the result (see
 * `catalogProposal`). Fails with `invariant-violation` at `catalog` when Library refuses the
 * batch (Library's failure kept as source). Reader failures pass through unchanged.
 */
function planOrganisationChange(
  changes: readonly unknown[],
  snapshot: Snapshot,
  dependencies: LibraryPlannerDependencies,
): AuthoringResult<Proposal> {
  const current = dependencies.workspace.read(snapshot);
  if (!current.ok) return current;
  const planned = dependencies.library.planOrganisation({
    snapshot: current.value.library,
    changes,
  });
  if (!planned.ok) return capabilityRefusalFailure('invariant-violation', 'catalog', planned.error);
  return catalogProposal(planned.value.candidate, snapshot);
}

/**
 * Proposes one write of the planned catalog over the stored one. Every collection and catalog
 * record version is a read, so Authoring refuses the commit if any of them changed. Fails with
 * `invariant-violation` at `catalog` when no catalog is stored, and `invalid-input` at `catalog`
 * when the proposal exceeds Authoring's limits.
 */
function catalogProposal(
  organisation: unknown,
  snapshot: Snapshot,
): AuthoringResult<Proposal> {
  const current = listLiveRecords(snapshot, 'catalog')[0];
  if (current === undefined)
    return authoringFailure('invariant-violation', 'catalog', 'A library catalog is required');
  return checkProposal(
    {
      writes: [{ kind: 'put', key: current.key, value: organisation, resources: [] }],
      reads: snapshot.records
        .filter((record) => ['collection', 'catalog'].includes(record.key.kind))
        .map((record) => ({ key: record.key, version: record.version })),
      diff: { kind: 'library-organisation' },
      warnings: [],
    },
    'catalog',
    'Library proposal could not be admitted',
  );
}
