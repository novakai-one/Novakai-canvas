/*
 * Why this file exists
 *
 * A source can name fonts and images (assets; Language calls them resources), and the service has
 * to hold their bytes before a change can use them. `asset @logo image source="./assets/logo.png"`
 * names a file next to the source. The CLI reads it and sends the bytes to the service to store
 * ("stage" them). A source can also name bytes the service already holds, by digest.
 *
 * This file names each step of that trip: the bytes read, what is to be staged, and what came
 * back. It declares types only; `core/resources/stage.ts` does the work.
 */
import type { AssetDigest, ResourceAlias } from '../brands.js';
import type { StageInput, SupportedMedia } from './foreign.js';
import type { ByteBackup } from './retained-request.js';

/**
 * A font or image file's bytes as base64 text, and the type its extension names. Assets checks
 * the bytes later.
 */
export interface LocalBytes {
  readonly base64: string;
  readonly mediaType: SupportedMedia;
}

/**
 * One font or image to stage: `pinned` by a digest the service already holds (nothing was read),
 * or `local` bytes read from a file, in `input` as Assets takes them. `alias` is its source name.
 */
export type StagedResource =
  | { readonly kind: 'pinned'; readonly alias: ResourceAlias; readonly digest: AssetDigest }
  | { readonly kind: 'local'; readonly alias: ResourceAlias; readonly input: StageInput };

/**
 * A font or image after staging: its name, and a copy of the bytes the service holds, kept so a
 * retry can put them back.
 */
export interface StagedBackup {
  readonly alias: ResourceAlias;
  readonly backup: ByteBackup;
}

/** A font or image's name in the source, and the digest of its stored bytes, for a request. */
export interface NamedAssetDigest {
  readonly alias: ResourceAlias;
  readonly digest: AssetDigest;
}
