/*
 * Why this file exists
 *
 * A snapshot is the workspace exactly as Authoring stores it: records and versions, not yet
 * checked. Before the service can render a collection or plan a change, each record must be checked
 * by its owner: Model checks collections, Library the catalog, Templates the presets.
 *
 * This file declares the checked result, `WorkspaceContents`. core/workspace/reader.ts builds it.
 * Declarations only. A record that fails its check is reported; nothing stored is changed.
 */
import type { Collection } from '../capability-types.js';
import type { Catalog as PresetCatalog } from '@novakai/canvas-templates';
import type { LibrarySnapshot } from '@novakai/canvas-library';

/**
 * One snapshot's contents, each part checked by its owner. Read-only copies: changing them never
 * changes what is stored.
 */
export interface WorkspaceContents {
  /** Every collection, checked by Model. */
  readonly collections: readonly Collection[];
  /**
   * The catalog, checked by Library: folders and entries, each collection's entry, recent visits.
   */
  readonly library: LibrarySnapshot;
  /** The stored themes and recipes, checked by Templates. */
  readonly presets: PresetCatalog;
}
