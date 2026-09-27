/*
 * One declared font or image as the resource reader returns it, and after staging. Pure
 * declarations. The resource reader builds `StagedResource`; core stages it with Assets and keeps
 * the backup of its exact normalized bytes for replay.
 */
import type { AssetDigest } from '../brands.js';
import type { StageInput } from './foreign.js';
import type { ByteBackup } from './retained-request.js';

/**
 * A declaration the source pins by digest (nothing was read), or local bytes to stage with Assets.
 * `alias` is the name the source declares it under.
 */
export type StagedResource =
  | { readonly kind: 'pinned'; readonly alias: string; readonly digest: AssetDigest }
  | { readonly kind: 'local'; readonly alias: string; readonly input: StageInput };

/** A declaration after staging: its alias and the backup of the bytes Assets holds for it. */
export interface StagedBackup {
  readonly alias: string;
  readonly backup: ByteBackup;
}

/** An alias a source declares and the Assets digest it is bound to in the Authoring request. */
export interface AssetBinding {
  readonly alias: string;
  readonly digest: AssetDigest;
}
