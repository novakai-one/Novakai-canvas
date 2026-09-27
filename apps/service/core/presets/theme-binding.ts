/*
 * One theme or asset binding in Model's checked form. Model validates each binding inside the
 * smallest possible collection, so selection never copies Model's rules. Pure over Model and
 * Assets; a refusal throws ResourceFault (select.ts turns it into `missing-asset`), and Authoring
 * owns recovery.
 * Planned: the service `core/presets/theme-binding.ts` PR merges this file with the copy in
 * `core/presets/builtin.ts` ('Resource binding') and deletes this file.
 */
import type {
  Assets,
  Collection,
  Preset,
  Request,
  ResourceRequest,
} from '../../contract/records/capabilities.js';
import type { ModelRules } from '../../contract/ports/capabilities.js';
import { prefixed } from '../resources/selection/digests.js';
import { ResourceFault, accepted } from '../resources/selection/refusal.js';

/** The one Model rule a binding needs. */
export type BindingModel = Pick<ModelRules, 'validate'>;
/** A collection's theme binding, as Model checks it. */
export type ThemeBinding = Collection['theme'];
/** One asset binding of a collection, as Model checks it. */
export type AssetBinding = Collection['assets'][number];
/** One supplied upload: an alias and the Assets digest of its bytes. */
export type Upload = Request['assets'][number];

/** The owners asset binding reads: Assets for the bytes' media type, Model for the check. */
export interface AssetOwners {
  readonly model: BindingModel;
  readonly assets: Pick<Assets, 'resolve'>;
}

/**
 * A theme preset as Model's checked theme binding. Throws ResourceFault for a preset that is not a
 * theme, or with Model's failure in `source`.
 */
export function themeBinding(
  preset: Preset,
  model: BindingModel,
): ThemeBinding {
  if (preset.kind !== 'theme') throw new ResourceFault('Selected preset is not a theme');
  const theme = {
    id: preset.id,
    version: preset.version,
    digest: prefixed(preset.digest),
    roles: preset.payload.roles,
  };
  return validBinding({ title: 'Resource binding', theme }, model).theme;
}

/**
 * Assets resolves the bytes and their media type; Model checks the authored metadata. Throws
 * ResourceFault with the Assets or Model failure in `source`, or when Model returns no binding.
 */
export function newAsset(
  upload: Upload,
  metadata: ResourceRequest,
  theme: ThemeBinding,
  owners: AssetOwners,
): AssetBinding {
  const blob = accepted(owners.assets.resolve(upload.digest));
  const asset = {
    id: upload.alias,
    digest: prefixed(upload.digest),
    mediaType: blob.descriptor.mediaType,
    alt: metadata.alt ?? upload.alias,
    ...optionalMetadata(metadata),
  };
  const validated = validBinding({ title: 'Asset binding', theme, assets: [asset] }, owners.model)
    .assets[0];
  if (!validated) throw new ResourceFault('Asset binding is missing after owner validation');
  return validated;
}

/** Model checks the bindings inside the smallest possible collection, so this file never copies Model's rules. */
function validBinding(
  fields: Readonly<Record<string, unknown>>,
  model: BindingModel,
): Collection {
  const base = { schemaVersion: 1, id: 'binding', revision: 0, arrangement: { algorithm: 'grid' } };
  return accepted(model.validate({ ...base, ...fields }));
}

/** Licence and attribution stay absent unless the source writes them; none is invented. */
function optionalMetadata(metadata: ResourceRequest): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries({ license: metadata.license, attribution: metadata.attribution }).filter(
      (item): item is [string, string] => typeof item[1] === 'string',
    ),
  );
}
