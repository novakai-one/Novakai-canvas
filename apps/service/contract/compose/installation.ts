/*
 * Shipped resource preparation: builtin sources, token files and preset preparation through their
 * real owners. Startup failures leave the existing workspace untouched; the caller repairs the
 * installation and retries.
 */
import { createTokenFileBindings, composeDesignSystem } from '@novakai/canvas-design-system';
import { composeTemplates } from '@novakai/canvas-templates';
import { createLanguage } from '@novakai/canvas-language';
import { validate, plan, stage } from '@novakai/canvas-model';
import type { Assets } from '@novakai/canvas-assets';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';

/** Resource/provider startup failures leave the existing workspace untouched; caller repairs the installation and retries. */
export async function prepareInstallation(
  resourceRoot: string,
  tokenRoot: string,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<Result<BuiltinResources>> {
  try {
    return await prepareInstallationInputs(resourceRoot, tokenRoot, assets);
  } catch {
    return failure(
      'unavailable',
      'installation',
      'Installation resource providers could not initialize',
    );
  }
}

/** Read and prepare shipped resources through their real owners; caller submits returned preset bindings through Authoring. */
async function prepareInstallationInputs(
  resourceRoot: string,
  tokenRoot: string,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<Result<BuiltinResources>> {
  const files = await createTokenFileBindings(tokenRoot);
  if (!files.ok) return failure('unavailable', 'tokens', files.error.message, files.error);
  const [loader, codecs, builtins] = await Promise.all([
    import('../../adapters/files/shipped-resources.js'),
    import('../../adapters/builtins/preset-codecs.js'),
    import('../../adapters/builtins/builtin-presets.js'),
  ]);
  const sources = await loader.loadBuiltinSources(resourceRoot, assets, files.value);
  if (!sources.ok) return sources;
  const context = {
    system: composeDesignSystem(),
    sources: sources.value.tokens,
    language: createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } }),
    resources: { themes: {}, assets: {} },
  };
  return builtins.prepareBuiltinPresets(sources.value, {
    context,
    templates: (context) => composeTemplates(codecs.createPresetCodecs(context)),
  });
}
