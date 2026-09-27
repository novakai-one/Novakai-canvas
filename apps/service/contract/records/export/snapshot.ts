/*
 * What the export route holds while it builds an artifact: the selected collection with the
 * workspace view it came from, and the failure arm of an Export result. Declarations only;
 * core/export owns the rules, and Export owns its failures.
 */
import type { Collection, ExportDiagnostic } from '../capabilities.js';
import type { WorkspaceContents } from '../workspace/contents.js';

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
