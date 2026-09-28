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
  Organisation,
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
import { success } from '../../../contract/errors.js';
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
  return {
    propose: (snapshot, collection) => proposeCollectionSave(snapshot, collection, dependencies),
  };
}

/** Plans the collection's write, keeping the stored files it needs, plus its catalog entry if new. */
function proposeCollectionSave(
  snapshot: Snapshot,
  collection: Collection,
  dependencies: CollectionPlannerDependencies,
): AuthoringResult<Proposal> {
  const contents = dependencies.workspace.read(snapshot);
  if (!contents.ok) {
    return contents;
  }
  const fileDigests = dependencies.resources.digestsForCollection(collection, contents.value);
  if (!fileDigests.ok) {
    return fileDigests;
  }
  const collectionWrite = plannedCollectionWrite(collection, fileDigests.value);
  return proposeWrites(collection, collectionWrite, contents.value, dependencies);
}

/** Plans the collection's write alone when it is already stored, and adds its catalog entry if not. */
function proposeWrites(
  collection: Collection,
  collectionWrite: unknown,
  contents: WorkspaceContents,
  dependencies: CollectionPlannerDependencies,
): AuthoringResult<Proposal> {
  if (isStoredCollection(contents, collection)) {
    return checkCollectionProposal([collectionWrite], collection.id);
  }
  return proposeNewCollection(collection, collectionWrite, contents, dependencies);
}

/** Asks Library to add the new collection to the catalog, and plans both writes. */
function proposeNewCollection(
  collection: Collection,
  collectionWrite: unknown,
  contents: WorkspaceContents,
  dependencies: CollectionPlannerDependencies,
): AuthoringResult<Proposal> {
  const catalog = planCatalogEntry(collection, contents, dependencies);
  if (!catalog.ok) {
    return catalog;
  }
  const catalogWrite = plannedCatalogWrite(catalog.value);
  return checkCollectionProposal([collectionWrite, catalogWrite], collection.id);
}

/** Asks Library to register the collection at the end of the catalog, and gives the new catalog. */
function planCatalogEntry(
  collection: Collection,
  contents: WorkspaceContents,
  dependencies: CollectionPlannerDependencies,
): AuthoringResult<Organisation> {
  const inventory = [...contents.library.collections, dependencies.workspace.project(collection)];
  const lastPlace = contents.library.organisation.entries.length;
  const registration = { op: 'register', value: { collection: collection.id, order: lastPlace } };
  const planned = dependencies.library.planMembership({
    snapshot: contents.library,
    changes: [registration],
    inventory,
  });
  if (!planned.ok) {
    return capabilityRefusalFailure('invariant-violation', 'catalog', planned.error);
  }
  return success(planned.value.candidate);
}

/** Whether the collection is already stored. */
function isStoredCollection(
  contents: WorkspaceContents,
  collection: Collection,
): boolean {
  return contents.collections.some((stored) => stored.id === collection.id);
}

/** Plans the collection's write, keeping the stored files it needs. */
function plannedCollectionWrite(
  collection: Collection,
  fileDigests: readonly AuthoringDigest[],
): unknown {
  return {
    kind: 'put',
    key: { kind: 'collection', id: collection.id },
    value: collection,
    resources: fileDigests,
  };
}

/** Plans the write of the catalog Library planned. */
function plannedCatalogWrite(organisation: Organisation): unknown {
  return {
    kind: 'put',
    key: { kind: 'catalog', id: organisation.id },
    value: organisation,
    resources: [],
  };
}

/** Checks the writes fit Authoring's limits, with no reads and the collection's ID as the diff. */
function checkCollectionProposal(
  writes: readonly unknown[],
  collectionId: string,
): AuthoringResult<Proposal> {
  const planned = { writes, reads: [], diff: { collection: collectionId }, warnings: [] };
  return checkProposal(planned, 'proposal', 'Collection proposal exceeds the authoring contract');
}
