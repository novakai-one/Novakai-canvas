/*
 * Why this file exists
 *
 * To make an SVG or PNG, Export asks the service for one collection at one revision, for example
 * `my-diagram` at revision 3. The export route then finds that collection and holds it while
 * Export builds the file. Several core/export files pass the same values between them.
 *
 * This file names those values: what Export asks for (`SnapshotIdentity`), the collection found
 * (`SelectedCollection`), and how Export says it found a mistake (`ExportFailure`).
 *
 * Declarations only. core/export has the rules, and Export keeps its own mistakes.
 */
import type { Collection, ExportDiagnostic, ExportSnapshotReader } from '../capabilities.js';
import type { WorkspaceContents } from '../workspace/contents.js';

/**
 * The collection ID and revision Export asks for, in Export's own ID type (not yet checked by
 * Model). The service's checked export request also fits it.
 */
export type SnapshotIdentity = Parameters<ExportSnapshotReader['acquire']>[0];

/**
 * How an Export `Result` says it found a mistake: `{ ok: false, error }`, with Export's diagnostic.
 */
export interface ExportFailure {
  readonly ok: false;
  readonly error: ExportDiagnostic;
}

/**
 * The asked-for collection at the asked-for revision, and the checked workspace it was found in.
 */
export interface SelectedCollection {
  readonly collection: Collection;
  readonly view: WorkspaceContents;
}
