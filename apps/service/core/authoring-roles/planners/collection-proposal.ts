/*
 * Why this file exists
 *
 * The DSL and Model planners both end by saving one collection. A new collection must also get an
 * entry in the catalog, or it would be saved but never listed. For example, `pnpm canvas create`
 * with a new diagram writes the collection and its catalog entry in the same save.
 *
 * This file plans that save once, for both planners (`CollectionPlanner`): the collection's write,
 * plus Library's catalog entry when the collection is new. It only plans; Authoring saves.
 */
import type {
  AuthoringResult,
  Collection,
  Proposal,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import type { AuthoringDigest } from '../../../contract/brands.js';
import type { LibraryRules } from '../../../contract/ports/capabilities.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import type {
  CollectionPlanner,
  ResourceSelector,
  WorkspaceReader,
} from '../../../contract/ports/workspace.js';
import { checkProposal, capabilityRefusalFailure } from './change-payload.js';

/** What planning a collection's save needs. */
export interface CollectionPlannerDependencies {
  /** Library's rules. Adds a new collection to the catalog. */
  readonly library: Pick<LibraryRules, 'planMembership'>;
  /** Reads the snapshot into checked collections and catalog. */
  readonly workspace: WorkspaceReader;
  /** Works out which stored files the collection needs, so its write keeps them. */
  readonly resources: Pick<ResourceSelector, 'digestsForCollection'>;
}

/**
 * Builds the collection planner. Its `propose` plans one collection's write, plus its catalog entry
 * when the collection is new. Mistakes: `invariant-violation` at `catalog` when Library refuses the
 * entry, or `invalid-input` at `proposal` when the save is over Authoring's limits. The reader's
 * and selector's pass through.
 */
export function createCollectionPlanner(
  dependencies: CollectionPlannerDependencies,
): CollectionPlanner {
  return { propose: (snapshot, collection) => propose(snapshot, collection, dependencies) };
}

/**
 * Reads the snapshot and the collection's expected resources, then builds the proposal (see
 * `proposal`). Reader and selector failures pass through unchanged.
 */
function propose(
  snapshot: Snapshot,
  collection: Collection,
  dependencies: CollectionPlannerDependencies,
): AuthoringResult<Proposal> {
  const view = dependencies.workspace.read(snapshot);
  if (!view.ok) return view;
  const blobs = dependencies.resources.digestsForCollection(collection, view.value);
  if (!blobs.ok) return blobs;
  return proposal(collection, view.value, blobs.value, dependencies);
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
  resources: readonly AuthoringDigest[],
  dependencies: CollectionPlannerDependencies,
): AuthoringResult<Proposal> {
  const write = {
    kind: 'put',
    key: { kind: 'collection', id: collection.id },
    value: collection,
    resources,
  };
  if (view.collections.some((item) => item.id === collection.id))
    return checked([write], collection.id);
  const inventory = [...view.library.collections, dependencies.workspace.project(collection)];
  const organisation = dependencies.library.planMembership({
    snapshot: view.library,
    changes: [
      {
        op: 'register',
        value: { collection: collection.id, order: view.library.organisation.entries.length },
      },
    ],
    inventory,
  });
  if (!organisation.ok)
    return capabilityRefusalFailure('invariant-violation', 'catalog', organisation.error);
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
  return checkProposal(
    { writes, reads: [], diff: { collection }, warnings: [] },
    'proposal',
    'Collection proposal exceeds the authoring contract',
  );
}
