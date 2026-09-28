/*
 * Why this file exists
 *
 * `pnpm dev --workspace ./my-workspace` opens a folder that holds a SQLite database and the
 * uploaded files. Start-up needs to know where things are, what a brand-new workspace starts with,
 * and how to open and close those stores.
 *
 * This file declares those start-up values: the chosen folders and names (`WorkspaceOptions`), what
 * a new workspace starts with (`NewWorkspaceSeed`), whether it is new (`StartupKind`), and the open
 * stores (`OpenStores`). Declarations only; a failed start closes what it opened.
 */
import type { Assets, Result as AssetResult } from '@novakai/canvas-assets';
import type { Persistence, Result as StorageResult } from '@novakai/canvas-persistence';
import type { Catalog } from '@novakai/canvas-templates';
import type { Result } from '../../errors.js';
import type { HostPath, Timestamp, WorkspaceId } from '../../brands.js';
/**
 * Where the workspace lives and what it is called, chosen at start-up. No request can change them.
 */
export interface WorkspaceOptions {
  /** The workspace folder. */
  readonly directory: HostPath;
  readonly workspace: WorkspaceId;
  /** The title written into a new workspace. */
  readonly title: string;
  /** The folder of shipped resources (fonts, recipes, libavoid's WebAssembly file). */
  readonly resourceRoot: HostPath;
  /** The folder of the design token sources. */
  readonly tokenRoot: HostPath;
  readonly createdAt: Timestamp;
}
/** What a brand-new workspace starts with: its ID, title, creation time and built-in presets. */
export type NewWorkspaceSeed = Pick<WorkspaceOptions, 'workspace' | 'title' | 'createdAt'> & {
  readonly presets: Catalog;
};
/** Whether start-up found a stored workspace (`existing`) or starts an empty one (`new`). */
export type StartupKind = 'existing' | 'new';
/**
 * How to open the two stores in a workspace folder. Each path is plain text; the store checks it.
 */
export interface StoreOpeners {
  /** Opens the uploaded-files store in the folder at `root`. */
  assets(root: string): AssetResult<Assets>;
  /** Opens the SQLite database at `location` for this workspace. */
  storage(
    location: string,
    workspace: WorkspaceId,
  ): StorageResult<Persistence>;
}
/** A workspace folder's open stores: its uploaded files and its database, and how to close both. */
export interface OpenStores {
  readonly assets: Assets;
  readonly storage: Persistence;
  close(): Promise<Result<void>>;
}
