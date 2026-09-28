/*
 * The workspace seams core features call each other through: the snapshot reader, resource
 * selection, the collection planner and the resource commands the session exposes. Declarations
 * only; core/workspace, core/resources and core/authoring-roles implement them and compose wires
 * them. Each owner keeps its failures; Authoring owns commit and retry.
 */
import type {
  Admission,
  AssetResult,
  AuthoringResult,
  Collection,
  Proposal,
  Request,
  Snapshot,
  StoredBlob,
} from '../records/capabilities.js';
import type { AuthoringDigest } from '../brands.js';
import type {
  CollectionProjectionInput,
  WorkspaceContents,
} from '../records/workspace/contents.js';
import type { ResourceSelection } from '../records/planning/selection.js';
import type { PresetPreparation, ResourceResult } from '../records/presets/preparation.js';

/** Reads a snapshot into checked contents; projects one collection into Library's input. */
export interface WorkspaceReader {
  /** Library's input for one collection: descriptions, sections, visibility. Never fails. */
  project(collection: Collection): CollectionProjectionInput;
  /**
   * The checked collections, catalog and presets of one snapshot. Fails with
   * `invariant-violation` when Model, Library or Templates rejects a stored record.
   */
  read(snapshot: Snapshot): AuthoringResult<WorkspaceContents>;
}

/** Selects the resources a request binds, and the digests one collection needs, from one snapshot. */
export interface ResourceSelector {
  /**
   * The themes and asset bytes one request binds. Fails with `missing-asset` at `resources` when
   * an owner refuses (its failure kept as source), or `invalid-input` at `resources` when the
   * payload cannot be decoded.
   */
  select(
    request: Request,
    snapshot: Snapshot,
  ): AuthoringResult<ResourceSelection>;
  /** The asset digests one collection's pins need. Fails as `select`. */
  forCollection(
    collection: Collection,
    workspace: WorkspaceContents,
  ): AuthoringResult<readonly AuthoringDigest[]>;
}

/** Proposes one collection write against one snapshot. */
export interface CollectionPlanner {
  /**
   * The collection write, plus Library's catalog membership for a new collection. Fails with
   * `invariant-violation` at `catalog` when Library refuses, or `invalid-input` at `proposal` over
   * Authoring's limits; reader and selector failures pass through.
   */
  propose(
    snapshot: Snapshot,
    collection: Collection,
  ): AuthoringResult<Proposal>;
}

/** Byte operations remain Assets-owned; semantic operations bind one explicit snapshot. */
export interface ResourceCommands {
  /** Stores one uploaded media file. Answers Assets' `stage` outcome unchanged. */
  stage(input: unknown): Promise<AssetResult<Admission>>;
  /**
   * Restores one digest's backup bytes under a reservation. Fails with `invalid-input` at
   * `restore` for a malformed body; otherwise answers Assets' outcome unchanged.
   */
  restore(input: unknown): Promise<AssetResult<void>>;
  /** Reads one stored blob by digest. Answers Assets' `resolve` outcome unchanged. */
  blob(input: unknown): AssetResult<StoredBlob>;
  /**
   * Pins a DSL request's theme aliases to exact presets; any other request comes back unchanged.
   * Fails with the selector's diagnostic, or `invalid-input` at `resources` for a malformed
   * request.
   */
  freeze(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<Request>;
  /**
   * Prepares one preset admission; nothing is written. Fails with the diagnostic of Templates,
   * theme normalisation or the selector, or `invalid-input` at `resources` for malformed input.
   */
  preparePreset(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<PresetPreparation>;
  /**
   * Expands one stored recipe into DSL source. Fails with `invalid-input` at `preset.kind` for a
   * non-recipe pin, at `language` for an unprintable expansion, at `resources` for malformed input,
   * or with the diagnostic of Templates or the selector.
   */
  instantiate(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<string>;
}
