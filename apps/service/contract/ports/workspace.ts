/*
 * The workspace seams core features call each other through: the snapshot reader, resource
 * selection, the collection planner and the resource commands the session exposes. Declarations
 * only; core/workspace, core/resources and core/authoring-roles implement them and compose wires
 * them. Each owner keeps its failures; Authoring owns commit and retry.
 */
import type { Admission, Result as AssetResult, StoredBlob } from '@novakai/canvas-assets';
import type {
  AuthoringResult,
  Collection,
  Digest,
  Proposal,
  Request,
  Snapshot,
} from '../records/capabilities.js';
import type { WorkspaceContents } from '../records/workspace/contents.js';
import type { ResourceSelection } from '../records/planning/selection.js';
import type { PresetPreparation, ResourceResult } from '../records/presets/preparation.js';

/** Reads a snapshot into checked contents; projects one collection into Library's input. */
export interface WorkspaceReader {
  project(collection: Collection): unknown;
  read(snapshot: Snapshot): AuthoringResult<WorkspaceContents>;
}

/** Selects the resources a request binds, and the digests one collection needs, from one snapshot. */
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

/** Proposes one collection write against one snapshot. */
export interface CollectionPlanner {
  propose(
    snapshot: Snapshot,
    collection: Collection,
  ): AuthoringResult<Proposal>;
}

/** Byte operations remain Assets-owned; semantic operations bind one explicit snapshot. */
export interface ResourceCommands {
  stage(input: unknown): Promise<AssetResult<Admission>>;
  restore(input: unknown): Promise<AssetResult<void>>;
  blob(input: unknown): AssetResult<StoredBlob>;
  freeze(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<Request>;
  preparePreset(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<PresetPreparation>;
  instantiate(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<string>;
}
