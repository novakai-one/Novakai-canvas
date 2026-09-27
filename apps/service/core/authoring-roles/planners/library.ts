/*
 * Authoring's `library` planner role: Library plans a batch of catalog organisation changes and
 * the planner proposes the one catalog write. Organisation changes never rewrite diagrams. Pure
 * over the injected owners. Authoring owns scope, commit and retry.
 */
import type {
  AuthoringResult,
  IntentPlanner,
  Proposal,
  Request,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import type { LibraryRules } from '../../../contract/ports/capabilities.js';
import type { WorkspaceReader } from '../../../contract/records/workspace/contents.js';
import { libraryCommand } from '../../../contract/records/planning/commands.js';
import { plannerId, proposalSchema } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';

/** What the library planner uses; compose passes Library from ServiceCapabilities. */
export interface LibraryPlannerOwners {
  readonly library: Pick<LibraryRules, 'planOrganisation'>;
  readonly workspace: Pick<WorkspaceReader, 'read'>;
}

/**
 * Binds the `library` planner. `plan` fails with `invalid-input` at `intent` (not a change),
 * `library` (bad envelope) or `catalog` (proposal over Authoring's limits), and with
 * `invariant-violation` at `catalog` when Library rejects the batch (source kept) or no catalog
 * exists. Reader failures pass through unchanged.
 */
export function createLibraryPlanner(owners: LibraryPlannerOwners): IntentPlanner {
  return {
    id: plannerId.parse('library'),
    plan: async (request, snapshot) => propose(request, snapshot, owners),
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
  owners: LibraryPlannerOwners,
): AuthoringResult<Proposal> {
  if (request.intent.kind !== 'change')
    return authoringFailure('invalid-input', 'intent', 'Expected a library change');
  const command = libraryCommand.safeParse(request.intent.payload);
  if (!command.success)
    return authoringFailure(
      'invalid-input',
      'library',
      'Library changes require a bounded change batch',
    );
  return planOrganisationChange(command.data.changes, snapshot, owners);
}

/**
 * Plans the batch on the stored catalog through Library, then proposes the result (see
 * `checkedProposal`). Fails with `invariant-violation` at `catalog` when Library refuses the
 * batch (Library's failure kept as source). Reader failures pass through unchanged.
 */
function planOrganisationChange(
  changes: readonly unknown[],
  snapshot: Snapshot,
  owners: LibraryPlannerOwners,
): AuthoringResult<Proposal> {
  const current = owners.workspace.read(snapshot);
  if (!current.ok) return current;
  const planned = owners.library.planOrganisation({ snapshot: current.value.library, changes });
  if (!planned.ok)
    return authoringFailure(
      'invariant-violation',
      'catalog',
      'The owning capability rejected this input',
      [],
      planned.error,
    );
  return checkedProposal(planned.value.candidate, snapshot);
}

/**
 * Proposes one write of the planned catalog over the stored one. Every collection and catalog
 * record version is a read, so Authoring refuses the commit if any of them changed. Fails with
 * `invariant-violation` at `catalog` when no catalog is stored, and `invalid-input` at `catalog`
 * when the proposal exceeds Authoring's limits.
 */
function checkedProposal(
  organisation: unknown,
  snapshot: Snapshot,
): AuthoringResult<Proposal> {
  const catalogs = snapshot.records.filter(
    (record) => record.key.kind === 'catalog' && !record.deleted,
  );
  const current = catalogs[0];
  if (current === undefined)
    return authoringFailure('invariant-violation', 'catalog', 'A library catalog is required');
  const parsed = proposalSchema.safeParse({
    writes: [{ kind: 'put', key: current.key, value: organisation, resources: [] }],
    reads: snapshot.records
      .filter((record) => ['collection', 'catalog'].includes(record.key.kind))
      .map((record) => ({ key: record.key, version: record.version })),
    diff: { kind: 'library-organisation' },
    warnings: [],
  });
  if (!parsed.success)
    return authoringFailure('invalid-input', 'catalog', 'Library proposal could not be admitted');
  return { ok: true, value: parsed.data };
}
