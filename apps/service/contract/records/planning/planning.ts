/*
 * Planning seams shared by the planners, candidate validation and leases: the resource selector
 * and the collection planner. Declarations only; core/resources/selection and
 * core/authoring-roles/planners implement them, and Authoring owns commit and retry.
 */
import type {
  Collection,
  Snapshot,
  Request,
  Json,
  Digest,
  ReadVersion,
  AuthoringResult,
  Proposal,
  ResolvedResources,
} from '../capabilities.js';
import type { WorkspaceContents } from '../workspace/contents.js';
/** Immutable alias resolution is repeated against the same snapshot, then compared with Authoring's admitted pins. */
export interface ResourceSelection {
  readonly resources: ResolvedResources;
  readonly pins: Json;
  readonly covered: readonly Digest[];
  readonly reads: readonly ReadVersion[];
}
export interface ResourceSelector {
  select(
    request: Request,
    snapshot: Snapshot,
  ): AuthoringResult<ResourceSelection>;
  forCollection(
    collection: Collection,
    workspace: WorkspaceContents,
  ): AuthoringResult<readonly Digest[]>;
}
export interface CollectionPlanner {
  propose(
    snapshot: Snapshot,
    collection: Collection,
  ): AuthoringResult<Proposal>;
}
