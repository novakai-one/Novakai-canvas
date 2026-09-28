/*
 * The checked contents of one Authoring snapshot, and the Library input one collection projects
 * into. Declarations only; core/workspace/reader.ts builds the contents (through the
 * WorkspaceReader port) and core/workspace/collection-projection.ts the projection input. Authoring
 * keeps its snapshot when a read fails; Library owns any rejection of a projection.
 */
import type { Collection } from '../capabilities.js';
import type { CollectionId, ObjectId, SectionId } from '../../brands.js';
import type { Catalog as PresetCatalog } from '@novakai/canvas-templates';
import type { LibrarySnapshot } from '@novakai/canvas-library';

/** Checked owner data for one consistent Authoring snapshot; these are read projections, never writable replicas. */
export interface WorkspaceContents {
  readonly collections: readonly Collection[];
  readonly library: LibrarySnapshot;
  readonly presets: PresetCatalog;
}

/**
 * The Library input for one collection, with Model's identities. Library checks it and mints its
 * own brands when it validates a snapshot or plans a membership change.
 */
export interface CollectionProjectionInput {
  readonly id: CollectionId;
  readonly revision: number;
  readonly title: string;
  /** The collection's description, or empty text when it has none. */
  readonly description: string;
  readonly sections: readonly SectionProjectionInput[];
  readonly objects: readonly ObjectProjectionInput[];
}

/** One section of the projection input: its ID and title. */
export interface SectionProjectionInput {
  readonly id: SectionId;
  readonly title: string;
}

/** One object of the projection input. */
export interface ObjectProjectionInput {
  readonly id: ObjectId;
  readonly label: string;
  /** The object's text blocks joined by newlines. */
  readonly description: string;
  /** The sections that show the object. */
  readonly visibleIn: readonly SectionId[];
}
