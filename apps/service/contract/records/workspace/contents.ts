/*
 * The checked contents of one Authoring snapshot and the reader seam that produces them.
 * Declarations only; core/workspace/reader.ts implements the reader, and Authoring keeps its
 * snapshot when a read fails.
 */
import type { Collection, Snapshot, AuthoringResult } from '../capabilities.js';
import type { Catalog as PresetCatalog } from '@novakai/canvas-templates';
import type { LibrarySnapshot } from '@novakai/canvas-library';
/** Checked owner data for one consistent Authoring snapshot; these are read projections, never writable replicas. */
export interface WorkspaceContents {
  readonly collections: readonly Collection[];
  readonly library: LibrarySnapshot;
  readonly presets: PresetCatalog;
}
/** Reads a snapshot into checked contents; projects one collection into Library's input. */
export interface WorkspaceReader {
  project(collection: Collection): unknown;
  read(snapshot: Snapshot): AuthoringResult<WorkspaceContents>;
}
