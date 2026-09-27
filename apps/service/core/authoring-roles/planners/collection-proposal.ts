/*
 * The collection planner the diagram planners share: proposes one collection write and, on a
 * create, Library's catalog membership in the same Authoring transaction. Pure over the injected
 * owners. Authoring owns scope, preconditions, commit and retry.
 */
import type {
  AuthoringResult,
  Collection,
  Digest,
  Proposal,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import type { LibraryRules } from '../../../contract/ports/capabilities.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import type {
  CollectionPlanner,
  ResourceSelector,
  WorkspaceReader,
} from '../../../contract/ports/workspace.js';
import { checkedProposal, ownerRejected } from './change-payload.js';

/** What the collection planner uses; compose passes Library from ServiceCapabilities. */
export interface CollectionProposalOwners {
  readonly library: Pick<LibraryRules, 'planMembership'>;
  readonly workspace: WorkspaceReader;
  readonly resources: Pick<ResourceSelector, 'forCollection'>;
}

/**
 * Binds the collection planner. `propose` fails with `invariant-violation` at `catalog` when
 * Library refuses the new membership (source kept), or `invalid-input` at `proposal` when the
 * proposal exceeds Authoring's limits. Reader and selector failures pass through unchanged.
 */
export function createCollectionPlanner(owners: CollectionProposalOwners): CollectionPlanner {
  return { propose: (snapshot, collection) => propose(snapshot, collection, owners) };
}

/**
 * Reads the snapshot and the collection's expected resources, then builds the proposal (see
 * `proposal`). Reader and selector failures pass through unchanged.
 */
function propose(
  snapshot: Snapshot,
  collection: Collection,
  owners: CollectionProposalOwners,
): AuthoringResult<Proposal> {
  const view = owners.workspace.read(snapshot);
  if (!view.ok) return view;
  const blobs = owners.resources.forCollection(collection, view.value);
  if (!blobs.ok) return blobs;
  return proposal(collection, view.value, blobs.value, owners);
}

/**
 * Proposes the collection write alone when the collection is already stored. A new collection
 * also gets Library's catalog membership as a second write. Fails with `invariant-violation` at
 * `catalog` when Library refuses the membership (Library's failure kept as source), and
 * `invalid-input` at `proposal` when the proposal exceeds Authoring's limits.
 */
function proposal(
  collection: Collection,
  view: WorkspaceContents,
  resources: readonly Digest[],
  owners: CollectionProposalOwners,
): AuthoringResult<Proposal> {
  const write = {
    kind: 'put',
    key: { kind: 'collection', id: collection.id },
    value: collection,
    resources,
  };
  if (view.collections.some((item) => item.id === collection.id))
    return checked([write], collection.id);
  const inventory = [...view.library.collections, owners.workspace.project(collection)];
  const organisation = owners.library.planMembership({
    snapshot: view.library,
    changes: [
      {
        op: 'register',
        value: { collection: collection.id, order: view.library.organisation.entries.length },
      },
    ],
    inventory,
  });
  if (!organisation.ok) return ownerRejected('invariant-violation', 'catalog', organisation.error);
  return checked(
    [
      write,
      {
        kind: 'put',
        key: { kind: 'catalog', id: organisation.value.candidate.id },
        value: organisation.value.candidate,
        resources: [],
      },
    ],
    collection.id,
  );
}

/**
 * Checks the writes against Authoring's proposal schema, with no reads and the collection ID as
 * the diff. Fails with `invalid-input` at `proposal` when they exceed Authoring's limits.
 */
function checked(
  writes: readonly unknown[],
  collection: string,
): AuthoringResult<Proposal> {
  return checkedProposal(
    { writes, reads: [], diff: { collection }, warnings: [] },
    'proposal',
    'Collection proposal exceeds the authoring contract',
  );
}
