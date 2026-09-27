import type { Collection, Snapshot, AuthoringResult } from '../capabilities.js';
import type { Catalog as PresetCatalog, Templates } from '@novakai/canvas-templates';
import type { LoweredIntent } from '@novakai/canvas-language';
import type { LibrarySnapshot } from '@novakai/canvas-library';
/** Checked owner data for one consistent Authoring snapshot; these are read projections, never writable replicas. */
export interface WorkspaceContents {
  readonly collections: readonly Collection[];
  readonly library: LibrarySnapshot;
  readonly presets: PresetCatalog;
}
export interface WorkspaceReader {
  project(collection: Collection): unknown;
  read(snapshot: Snapshot): AuthoringResult<WorkspaceContents>;
}
export interface WorkspaceReaderOwners {
  readonly templates: Pick<Templates<LoweredIntent>, 'readCatalog'>;
}
