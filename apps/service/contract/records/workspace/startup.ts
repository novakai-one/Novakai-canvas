/*
 * Startup records: the host-selected workspace options, the trusted installation records the
 * bootstrap planner writes, whether a workspace was found, and the native storage handles.
 * Declarations only; compose/startup.ts opens and closes them, and a failed start leaves the
 * caller to close what opened and retry.
 */
import type { Assets, Result as AssetResult } from '@novakai/canvas-assets';
import type { Persistence, Result as StorageResult } from '@novakai/canvas-persistence';
import type { Catalog } from '@novakai/canvas-templates';
import type { Result } from '../../errors.js';
import type { HostPath, Timestamp, WorkspaceId } from '../../brands.js';
/** Host-selected absolute locations never originate in diagram DSL or browser-authored content. */
export interface WorkspaceOptions {
  readonly directory: HostPath;
  readonly workspace: WorkspaceId;
  readonly title: string;
  readonly resourceRoot: HostPath;
  readonly tokenRoot: HostPath;
  readonly createdAt: Timestamp;
}
/** Trusted startup input is fixed before registering its private planner; request payloads cannot replace these records. */
export type Installation = Pick<WorkspaceOptions, 'workspace' | 'title' | 'createdAt'> & {
  readonly presets: Catalog;
};
/** Whether startup found a stored workspace (`existing`) or starts an empty one (`new`). */
export type WorkspaceState = 'existing' | 'new';
export interface NativeFactories {
  assets(root: string): AssetResult<Assets>;
  storage(
    location: string,
    workspace: WorkspaceId,
  ): StorageResult<Persistence>;
}
export interface NativeWorkspace {
  readonly assets: Assets;
  readonly storage: Persistence;
  close(): Promise<Result<void>>;
}
