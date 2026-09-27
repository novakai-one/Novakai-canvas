import type { Collection, Snapshot, RecordKey, AuthoringResult } from '../records/capabilities.js';
import type { WorkspaceContents, WorkspaceReader } from '../records/workspace/contents.js';
import type { RenderingJob } from '../records/rendering/job.js';
import type { DiagramProducer } from './rendering.js';
import type { Scene } from '@novakai/canvas-layout';
/** Resource-backed job construction remains separate from scheduling and rendered scene admission. */
export interface RenderJobs {
  create(
    collection: Collection,
    view: WorkspaceContents,
    previous: Scene | null,
    id: string,
  ): AuthoringResult<RenderingJob>;
}
export interface FeasibilityOwners {
  readonly workspace: WorkspaceReader;
  readonly jobs: RenderJobs;
  readonly producer: DiagramProducer;
}
export interface ChangedCollections {
  read(
    snapshot: Snapshot,
    changed: readonly RecordKey[],
  ): AuthoringResult<readonly Collection[]>;
}
