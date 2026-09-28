/*
 * Why this file exists
 *
 * Every workspace starts with the shipped fonts, design tokens and recipe starters from
 * `resources/`. Before start-up can use them, they have to be read from disk, and the built-in
 * themes and recipes made from them.
 *
 * This file does that, through the real capabilities. It saves no record: start-up saves the
 * built-in themes and recipes through Authoring. If it fails, the workspace is left as it was; the
 * person fixes the install and starts again.
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
 * Reads the shipped resources and makes the built-in themes and recipes (the preset catalog).
 * Each shipped font is copied into `assets`, the workspace's file store, to get its digest; no
 * record is saved. Fails with `unavailable` when the shipped files can't be read, and
 * `invalid-input` at `builtins` when a built-in theme or recipe can't be made.
 */
export async function prepareBuiltins(
  resourceRoot: HostPath,
  tokenRoot: HostPath,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<Result<BuiltinResources>> {
  try {
    return await readAndPrepareBuiltins(resourceRoot, tokenRoot, assets);
  } catch {
    return failure(
      'unavailable',
      'installation',
      'Installation resource providers could not initialize',
    );
  }
}

/** Reads the shipped resources, then makes the built-in presets (see `prepareBuiltins`). */
async function readAndPrepareBuiltins(
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
