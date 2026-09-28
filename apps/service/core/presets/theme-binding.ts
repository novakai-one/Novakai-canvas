/*
 * Why this file exists
 *
 * A diagram names its theme and images through "bindings" that Model must accept: for example the
 * `ink` theme with its version and `sha256:` digest, or a logo image with its alt text. Model only
 * checks a binding inside a whole collection, and the service must not copy Model's rules.
 *
 * This file puts the bindings in the smallest collection Model accepts, lets Model check it, and
 * answers only the checked bindings. A refusal is Model's own failure, unchanged; the caller picks
 * the code it answers. It never saves anything.
 */
import type { Collection, ThemePreset } from '../../contract/records/capability-types.js';
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type { ModelRules } from '../../contract/ports/capabilities.js';
import { success, type Result } from '../../contract/errors.js';
import { addDigestPrefix, type PrefixedDigest } from '../../contract/brands.js';

/** The one Model check a binding needs. */
export type BindingModel = Pick<ModelRules, 'validate'>;
/** A collection's theme binding (ID, version, `sha256:` digest and roles), as Model checked it. */
export type ThemeBinding = Collection['theme'];
/** One of a collection's image bindings, as Model checked it. */
export type AssetBinding = Collection['assets'][number];

/** An image binding before Model checks it. The text fields are as sent; Model checks them. */
export interface AssetDraft {
  /** The image's name in the DSL, such as `logo`. */
  readonly id: string;
  /** The digest of the stored bytes, as `sha256:<hex>`. */
  readonly digest: PrefixedDigest;
  readonly mediaType: string;
  readonly alt: string;
  readonly license?: string;
  readonly attribution?: string;
}

/**
 * Makes a theme preset's binding (its ID, version, digest with `sha256:`, and roles) and has Model
 * check it. Fails with Model's own failure when Model refuses it.
 */
export function checkThemeBinding(
  preset: ThemePreset,
  model: BindingModel,
): Result<ThemeBinding, FailureSource> {
  const theme = {
    id: preset.id,
    version: preset.version,
    digest: addDigestPrefix(preset.digest),
    roles: preset.payload.roles,
  };
  const checked = bindingCollection({ title: 'Resource binding', theme }, model);
  if (!checked.ok) return checked;
  return success(checked.value.theme);
}

/**
 * Has Model check image bindings, in order, next to a theme binding Model already accepted.
 * Fails with Model's own failure when Model refuses one.
 */
export function checkAssetBindings(
  drafts: readonly AssetDraft[],
  theme: ThemeBinding,
  model: BindingModel,
): Result<readonly AssetBinding[], FailureSource> {
  const checked = bindingCollection({ title: 'Asset binding', theme, assets: drafts }, model);
  if (!checked.ok) return checked;
  return success(checked.value.assets);
}

/**
 * The smallest collection Model checks: ID `binding`, revision 0, grid arrangement, plus the
 * binding fields. Model's result unchanged; Model never throws.
 */
function bindingCollection(
  fields: Readonly<Record<string, unknown>>,
  model: BindingModel,
): ReturnType<BindingModel['validate']> {
  const base = { schemaVersion: 1, id: 'binding', revision: 0, arrangement: { algorithm: 'grid' } };
  return model.validate({ ...base, ...fields });
}
