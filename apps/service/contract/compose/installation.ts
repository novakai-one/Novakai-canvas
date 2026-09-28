/*
 * Why this file exists
 *
 * Every workspace starts with the shipped fonts, design tokens and recipe starters from
 * `resources/`. Before start-up can use them, they have to be read from disk, and the built-in
 * themes and recipes made from them.
 *
 * This file does that, through the real capabilities. It saves nothing. If it fails, the workspace
 * is left as it was; the person fixes the install and starts again.
 */
import { createTokenFileBindings } from '@novakai/canvas-design-system';
import type { Assets } from '@novakai/canvas-assets';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import type { HostPath } from '../brands.js';
import { prepareBuiltinPresets } from '../../core/presets/builtin.js';
import { createServiceCapabilities } from './capabilities.js';

/**
 * Reads the shipped resources and makes the built-in preset catalog from them. Fails with
 * `unavailable` when the token files or shipped resources can't be read, and `invalid-input` at
 * `builtins` when a built-in theme or recipe can't be made.
 */
export async function prepareInstallation(
  resourceRoot: HostPath,
  tokenRoot: HostPath,
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
  resourceRoot: HostPath,
  tokenRoot: HostPath,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<Result<BuiltinResources>> {
  const files = await createTokenFileBindings(tokenRoot);
  if (!files.ok) return failure('unavailable', 'tokens', files.error.message, files.error);
  const loader = await import('../../adapters/files/shipped-resources.js');
  const sources = await loader.loadBuiltinSources(resourceRoot, assets, files.value);
  if (!sources.ok) return sources;
  return prepareBuiltinPresets(sources.value, createServiceCapabilities(sources.value.tokens));
}
