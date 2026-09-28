/*
 * The checked contents of one Authoring snapshot, and the Library input one collection projects
 * into. Declarations only; core/workspace/reader.ts builds the contents (through the
 * WorkspaceReader port) and core/workspace/collection-projection.ts the projection input. Authoring
 * keeps its snapshot when a read fails; Library owns any rejection of a projection.
 */
import type { Collection } from '../capabilities.js';
import type { Catalog as PresetCatalog } from '@novakai/canvas-templates';
import type {
  CollectionProjection,
  LibrarySnapshot,
  ObjectProjection,
  SectionProjection,
} from '@novakai/canvas-library';

/** Checked owner data for one consistent Authoring snapshot; these are read projections, never writable replicas. */
export interface WorkspaceContents {
  readonly collections: readonly Collection[];
  readonly library: LibrarySnapshot;
  readonly presets: PresetCatalog;
}

/**
 * The Library input for one collection: Library's own projection record, so a change to Library's
 * record fails typecheck here instead of failing every create at runtime. Model's identities carry
 * the same brands. Library still checks the input (nonblank titles, known sections) when it
 * validates a snapshot or plans a membership change.
 */
export type CollectionProjectionInput = CollectionProjection;

/** One section of the projection input: its ID and title. */
export type SectionProjectionInput = SectionProjection;

/**
 * One object of the projection input: its ID, label, text blocks joined by newlines as the
 * description, and the sections that show it.
 */
export type ObjectProjectionInput = ObjectProjection;
