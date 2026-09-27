/*
 * Theme and asset bindings in Model's checked form. Model checks each binding inside the smallest
 * possible collection, so no caller copies Model's rules; only the checked `theme` or `assets` is
 * read back. Pure over Model. Each function returns Model's own refusal: resource selection turns
 * it into `missing-asset`, built-in preparation into `invalid-input` at `builtins`. Authoring owns
 * recovery.
 */
import type { Collection, ThemePreset } from '../../contract/records/capabilities.js';
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type { ModelRules } from '../../contract/ports/capabilities.js';
import { success, type Result } from '../../contract/errors.js';

/** The one Model rule a binding needs. */
export type BindingModel = Pick<ModelRules, 'validate'>;
/** A collection's theme binding, as Model checks it. */
export type ThemeBinding = Collection['theme'];
/** One asset binding of a collection, as Model checks it. */
export type AssetBinding = Collection['assets'][number];

/** An asset binding before Model checks it; `digest` is pinned as `sha256:<hex>`. */
export interface AssetDraft {
  readonly id: string;
  readonly digest: string;
  readonly mediaType: string;
  readonly alt: string;
  readonly license?: string;
  readonly attribution?: string;
}

/**
 * A theme preset as Model's checked theme binding: its ID, version, `sha256:`-pinned digest and
 * roles. Fails with Model's `validation-failed` when Model rejects the pin.
 */
export function themeBinding(
  preset: ThemePreset,
  model: BindingModel,
): Result<ThemeBinding, FailureSource> {
  const theme = {
    id: preset.id,
    version: preset.version,
    digest: `sha256:${preset.digest}`,
    roles: preset.payload.roles,
  };
  const checked = bindingCollection({ title: 'Resource binding', theme }, model);
  if (!checked.ok) return checked;
  return success(checked.value.theme);
}

/**
 * Asset drafts as Model's checked asset bindings, in draft order, each checked against one
 * admitted theme binding. Fails with Model's `validation-failed` when Model rejects a draft.
 */
export function assetBindings(
  drafts: readonly AssetDraft[],
  theme: ThemeBinding,
  model: BindingModel,
): Result<Collection['assets'], FailureSource> {
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
