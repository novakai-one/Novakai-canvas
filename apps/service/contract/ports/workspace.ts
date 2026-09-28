/*
 * Why this file exists
 *
 * Several parts of service core need the same workspace jobs: read a snapshot into checked
 * collections, pick the themes and files a request uses, plan a collection's write. For example,
 * the DSL planner and the Model planner must both save "this collection, and its catalog entry if
 * it is new" in exactly the same way.
 *
 * Rather than import each other, they meet through the interfaces here, and compose joins them.
 * Declarations only. Authoring still decides whether a change is saved.
 */
import type {
  Admission as StoredUpload,
  AssetResult,
  AuthoringResult,
  Collection,
  CollectionProjection,
  Proposal,
  Request,
  Snapshot,
  StoredBlob,
} from '../records/capability-types.js';
import type { AuthoringDigest } from '../brands.js';
import type { WorkspaceContents } from '../records/workspace/contents.js';
import type { ResourceSelection } from '../records/planning/selection.js';
import type { PresetPreparation } from '../records/presets/preparation.js';
import type { ResourceResult } from '../records/presets/resource-commands.js';

/** Reads a snapshot into checked contents, and turns one collection into its catalog entry. */
export interface WorkspaceReader {
  /**
   * Turns one collection into the entry Library keeps for it: its title, description, sections,
   * and which sections show each object. Never fails; Library checks the entry later.
   */
  project(collection: Collection): CollectionProjection;
  /**
   * Reads the checked collections, catalog and presets out of one snapshot. Fails with
   * `invariant-violation` when Model, Library or Templates refuses a stored record.
   */
  read(snapshot: Snapshot): AuthoringResult<WorkspaceContents>;
}

/**
 * Works out, from one snapshot, which themes and files a request uses, and which files a collection
 * needs.
 */
export interface ResourceSelector {
  /**
   * Picks the themes and stored files one request uses. Fails with `missing-asset` at `resources`
   * when a capability refuses one (its failure kept as source), or `invalid-input` at `resources`
   * when the request's payload can't be read.
   */
  select(
    request: Request,
    snapshot: Snapshot,
  ): AuthoringResult<ResourceSelection>;
  /**
   * The digests of the stored files one collection's exact theme versions and images need. Fails
   * like `select`.
   */
  digestsForCollection(
    collection: Collection,
    contents: WorkspaceContents,
  ): AuthoringResult<readonly AuthoringDigest[]>;
}

/** Plans the write that saves one collection. */
export interface CollectionPlanner {
  /**
   * Plans the collection's write, plus its catalog entry when the collection is new. Fails with
   * `invariant-violation` at `catalog` when Library refuses, or `invalid-input` at `proposal` when
   * the write is over Authoring's limits; the reader's and selector's failures pass through.
   */
  propose(
    snapshot: Snapshot,
    collection: Collection,
  ): AuthoringResult<Proposal>;
}

/**
 * The commands behind `/api/v1/resources/…`. Each checks its `input`, the request body as sent.
 * `ResourceResult` is a `Result` whose code can be Authoring's or Templates'.
 */
export interface ResourceCommands {
  /**
   * Stores one uploaded file (a font or an image) and answers its stored description (Assets calls
   * it an `Admission`). Answers Assets' `stage` outcome unchanged.
   */
  storeUpload(input: unknown): Promise<AssetResult<StoredUpload>>;
  /**
   * Puts back the bytes of one file from a backup, under a hold so nothing else writes it. Fails
   * with `invalid-input` at `restore` for a malformed body; otherwise answers Assets' outcome
   * unchanged.
   */
  restore(input: unknown): Promise<AssetResult<void>>;
  /** Reads one stored file by its digest. Answers Assets' `resolve` outcome unchanged. */
  readFile(input: unknown): AssetResult<StoredBlob>;
  /**
   * Fixes the themes a DSL request uses to exact versions ("freezing"). A theme named `paper`
   * becomes the exact `paper@1.0.0#sha256:…` stored now, so a later apply uses that same version.
   * Any other request comes back unchanged. Fails with the selector's diagnostic, or
   * `invalid-input` at `resources` for a malformed request.
   */
  freeze(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<Request>;
  /**
   * Prepares a theme or recipe for saving, without saving it. Fails with the diagnostic of
   * Templates, theme saving or the selector, or `invalid-input` at `resources` for malformed
   * input.
   */
  preparePreset(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<PresetPreparation>;
  /**
   * Turns one stored recipe into DSL text for a new collection. Fails with `invalid-input` at
   * `preset.kind` when the named preset is not a recipe, at `language` when the result can't be
   * printed, at `resources` for malformed input, or with the diagnostic of Templates or the
   * selector.
   */
  instantiate(
    input: unknown,
    snapshot: Snapshot,
  ): ResourceResult<string>;
}
