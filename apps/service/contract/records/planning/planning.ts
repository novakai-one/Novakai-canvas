import type {
  Collection,
  Snapshot,
  Request,
  Json,
  Digest,
  ReadVersion,
  AuthoringResult,
  Proposal,
} from '../capabilities.js';
import type { ResolvedResources, Language } from '@novakai/canvas-language';
import type { WorkspaceContents, WorkspaceReader } from '../workspace/contents.js';
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
export interface DiagramPlannerOwners {
  readonly language: Language;
  readonly workspace: WorkspaceReader;
  readonly resources: ResourceSelector;
  readonly collections: CollectionPlanner;
}
