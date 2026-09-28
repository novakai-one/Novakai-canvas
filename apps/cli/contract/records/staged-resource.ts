/*
 * One declared font or image: the bytes the resource reader read for it, the resource core stages,
 * and the result of staging. Pure declarations. The resource reader returns `LocalBytes`; core
 * decides pinned or local, stages it with Assets and keeps the backup of its exact normalized bytes
 * for replay.
 */
import type { AssetDigest, ResourceAlias } from '../brands.js';
import type { StageInput, SupportedMedia } from './foreign.js';
import type { ByteBackup } from './retained-request.js';

/** A declared file's bytes as base64, with the media type its extension names. Assets checks the bytes. */
export interface LocalBytes {
  readonly base64: string;
  readonly mediaType: SupportedMedia;
}

/**
 * A declaration the source pins by digest (nothing was read), or local bytes to stage with Assets.
 * `alias` is the name the source declares it under.
 */
export type StagedResource =
  | { readonly kind: 'pinned'; readonly alias: ResourceAlias; readonly digest: AssetDigest }
  | { readonly kind: 'local'; readonly alias: ResourceAlias; readonly input: StageInput };

/** A declaration after staging: its alias and the backup of the bytes Assets holds for it. */
export interface StagedBackup {
  readonly alias: ResourceAlias;
  readonly backup: ByteBackup;
}

/** An alias a source declares and the Assets digest it is bound to in the Authoring request. */
export interface AssetBinding {
  readonly alias: ResourceAlias;
  readonly digest: AssetDigest;
}
