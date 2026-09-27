/*
 * Workspace input seam: readers for server and stored input, and builders for requests.
 * Declarations only; `adapters/edge/workspace-inputs.ts` implements it with the owners'
 * schemas. Readers answer a `Result` and never throw; the caller that read owns recovery.
 */
import type { OrganisationChange } from '@novakai/canvas-library';
import type { Result } from '../errors.js';
import type { EditingBase, RecoveredSource } from '../records/editor-recovery.js';
import type { CarriedSnapshot } from '../records/submission.js';
import type { Collection, Snapshot, Request, RenderDocument, Change } from '../records/owners.js';

/** Checks unknown input with the owners' schemas and builds Authoring requests. */
export interface WorkspaceInputs {
  history(
    input: unknown,
    direction: 'undo' | 'redo',
    id: string,
  ): Result<Request | null>;
  snapshot(input: unknown): Result<CarriedSnapshot>;
  diagram(input: unknown): Result<RenderDocument>;
  source(collection: Collection): Result<string>;
  sourceRecovery(input: unknown): Result<RecoveredSource>;
  dsl(
    snapshot: EditingBase,
    id: string,
    source: string,
    mode: 'create' | 'replace',
    request: string,
  ): Result<Request>;
  model(
    snapshot: EditingBase,
    collection: string,
    changes: readonly Change[],
    request: string,
  ): Result<Request>;
  library(
    snapshot: Snapshot,
    changes: readonly OrganisationChange[],
    request: string,
  ): Result<Request>;
  newSource(
    id: string,
    title: string,
  ): string;
}
