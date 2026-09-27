import type { Assets, Result as AssetResult } from '@novakai/canvas-assets';
import type { Persistence, Result as StorageResult } from '@novakai/canvas-persistence';
import type { Result } from '../../errors.js';
/** Host-selected absolute locations never originate in diagram DSL or browser-authored content. */
export interface WorkspaceOptions {
  readonly directory: string;
  readonly workspace: string;
  readonly title: string;
  readonly resourceRoot: string;
  readonly tokenRoot: string;
  readonly createdAt: number;
}
/** Whether startup found a stored workspace (`existing`) or starts an empty one (`new`). */
export type WorkspaceState = 'existing' | 'new';
export interface NativeFactories {
  assets(root: string): AssetResult<Assets>;
  storage(
    location: string,
    workspace: string,
  ): StorageResult<Persistence>;
}
export interface NativeWorkspace {
  readonly assets: Assets;
  readonly storage: Persistence;
  close(): Promise<Result<void>>;
}
