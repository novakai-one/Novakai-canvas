/*
 * The checked contents of one Authoring snapshot. Declarations only; core/workspace/reader.ts
 * builds them (through the WorkspaceReader port), and Authoring keeps its snapshot when a read
 * fails.
 */
import type { Collection } from '../capabilities.js';
import type { Catalog as PresetCatalog } from '@novakai/canvas-templates';
import type { LibrarySnapshot } from '@novakai/canvas-library';
/** Checked owner data for one consistent Authoring snapshot; these are read projections, never writable replicas. */
export interface WorkspaceContents {
  readonly collections: readonly Collection[];
  readonly library: LibrarySnapshot;
  readonly presets: PresetCatalog;
}
