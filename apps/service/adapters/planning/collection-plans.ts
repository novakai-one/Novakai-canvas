import { planMembership } from '@novakai/canvas-library';
import { proposalSchema, failure } from '@novakai/canvas-authoring';
import type { Snapshot, Proposal, Result, Digest } from '@novakai/canvas-authoring';
import type { Collection } from '@novakai/canvas-model';
import type {
  WorkspaceReader,
  WorkspaceContents,
} from '../../contract/records/workspace/contents.js';
import type {
  ResourceSelector,
  CollectionPlanner,
} from '../../contract/records/planning/planning.js';
/** A create includes catalog membership in the same proposed Authoring transaction as its canonical collection. */
function propose(
  snapshot: Snapshot,
  collection: Collection,
  workspace: WorkspaceReader,
  resources: ResourceSelector,
): Result<Proposal> {
  const view = workspace.read(snapshot);
  if (!view.ok) return view;
  const blobs = resources.forCollection(collection, view.value);
  if (!blobs.ok) return blobs;
  return proposal(collection, view.value, blobs.value, workspace);
}
/** Updating existing semantics never rewrites catalog organisation or other collections. */
function proposal(
  collection: Collection,
  view: WorkspaceContents,
  resources: readonly Digest[],
  workspace: WorkspaceReader,
): Result<Proposal> {
  const write = {
    kind: 'put',
    key: { kind: 'collection', id: collection.id },
    value: collection,
    resources,
  };
  if (view.collections.some((item) => item.id === collection.id))
    return checked([write], collection.id);
  const inventory = [...view.library.collections, workspace.project(collection)];
  const organisation = planMembership({
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
    return failure(
      'invariant-violation',
      'catalog',
      'The owning capability rejected this input',
      [],
      organisation.error,
    );
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
/** Authoring's public schema mints record identity brands and JSON payloads before admitting this owner proposal. */
function checked(
  writes: readonly unknown[],
  collection: string,
): Result<Proposal> {
  const result = proposalSchema.safeParse({
    writes,
    reads: [],
    diff: { collection },
    warnings: [],
  });
  if (!result.success)
    return failure(
      'invalid-input',
      'proposal',
      'Collection proposal exceeds the authoring contract',
    );
  return { ok: true, value: result.data };
}
/** Bind canonical Model proposals to Library membership; Authoring alone checks scope, preconditions and commits. */
export function createCollectionPlanner(
  workspace: WorkspaceReader,
  resources: ResourceSelector,
): CollectionPlanner {
  return { propose: (snapshot, collection) => propose(snapshot, collection, workspace, resources) };
}
