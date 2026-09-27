/*
 * Whether a committed collection's pins still match the stored presets and bytes, and which bytes
 * it needs. Pure over Templates and Assets; a mismatch throws ResourceFault (select.ts turns it
 * into `missing-asset`), a malformed digest throws zod's error (`invalid-input`), and Authoring
 * owns recovery.
 */
import type {
  Assets,
  Collection,
  Digest,
  LoweredIntent,
  Templates,
} from '../../../contract/records/capabilities.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import type { AssetBinding } from './model-binding.js';
import { bare, sortedDigests } from './digests.js';
import { ResourceFault, accepted } from './refusal.js';

/** The owners the check reads: Templates for the pinned theme, Assets for the stored bytes. */
export interface CollectionOwners {
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
  readonly assets: Pick<Assets, 'resolve'>;
}

/**
 * A collection's theme pin must name a stored theme; its fonts and asset bytes are returned sorted.
 * Throws ResourceFault when Templates or Assets refuses a pin (owner failure in `source`), when the
 * pin is not a theme, or when the theme roles or an asset's media type differ. Throws zod's error
 * when a font or asset digest is malformed.
 */
export function collectionResources(
  collection: Collection,
  view: WorkspaceContents,
  owners: CollectionOwners,
): readonly Digest[] {
  const theme = accepted(
    owners.templates.read(view.presets, {
      kind: 'theme',
      id: collection.theme.id,
      version: collection.theme.version,
      digest: bare(collection.theme.digest),
    }),
  );
  if (theme.kind !== 'theme') throw new ResourceFault('Collection pin does not identify a theme');
  checkRoles(collection.theme.roles, theme.payload.roles);
  checkMediaTypes(collection.assets, owners);
  return sortedDigests([
    ...theme.payload.fonts,
    ...collection.assets.map((item) => bare(item.digest)),
  ]);
}

/** The collection's theme roles must equal the pinned preset's roles, in any order. */
function checkRoles(
  pinned: readonly string[],
  preset: readonly string[],
): void {
  if (JSON.stringify(pinned.toSorted()) !== JSON.stringify(preset.toSorted()))
    throw new ResourceFault('Collection theme roles differ from the pinned preset');
}

/** Each asset's stored bytes must still have the media type the collection records. */
function checkMediaTypes(
  bindings: readonly AssetBinding[],
  owners: CollectionOwners,
): void {
  bindings.forEach((item) => {
    const blob = accepted(owners.assets.resolve(bare(item.digest)));
    if (blob.descriptor.mediaType !== item.mediaType)
      throw new ResourceFault(`Asset media type differs: ${item.id}`);
  });
}
