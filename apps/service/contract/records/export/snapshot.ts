/*
 * What the export route holds while it builds an artifact: the identity Export asks a snapshot
 * for, the selected collection with the workspace view it came from, and the failure arm of an
 * Export result. Declarations only; core/export owns the rules, and Export owns its failures.
 */
import type { Collection, ExportDiagnostic, ExportSnapshotReader } from '../capabilities.js';
import type { WorkspaceContents } from '../workspace/contents.js';

/**
 * The collection ID and revision a snapshot is asked for, as Export's snapshot port passes them:
 * Export's own ID grammar, not yet Model's. The service's checked request also fits it.
 */
export type SnapshotIdentity = Parameters<ExportSnapshotReader['acquire']>[0];

/** The failure arm of an Export result. */
export interface ExportFailure {
  readonly ok: false;
  readonly error: ExportDiagnostic;
}

/** The requested collection at its requested revision, with the workspace view it came from. */
export interface SelectedCollection {
  readonly collection: Collection;
  readonly view: WorkspaceContents;
}
