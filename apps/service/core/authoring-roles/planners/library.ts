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
  readonly workspace: WorkspaceReader;
}
/** Organisation commands are interpreted only by Library; the host cannot write an arbitrary organisation record. */
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
/** The complete inventory checks membership and folder invariants before any write is proposed. */
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
/** Collection inventory dependencies participate in conditional admission; organisation changes never rewrite diagrams. */
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
/** Authoring alone admits and commits the Library-owned candidate through the usual receipt/history transaction. */
export function createLibraryPlanner(owners: LibraryPlannerOwners): IntentPlanner {
  return {
    id: plannerId.parse('library'),
    plan: async (request, snapshot) => propose(request, snapshot, owners),
  };
}
