/*
 * Why this file exists
 *
 * Every workspace starts with the shipped fonts, design tokens and recipe starters from
 * `resources/`. Before start-up can use them, they have to be read from disk, and the built-in
 * themes and recipes made from them.
 *
 * This file does that, through the real capabilities. It copies the fonts into the file store (to
 * get their digests) but writes no workspace record: start-up saves the built-in themes and recipes
 * through Authoring. If it fails, the person fixes the install and starts again.
 */
import { createTokenFileBindings } from '@novakai/canvas-design-system';
import type { Assets } from '@novakai/canvas-assets';
import type { PreparedBuiltins } from '../records/presets/builtins.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import type { HostPath } from '../brands.js';
import type { CapabilityFailure } from '../records/transport/failure-source.js';
import { prepareBuiltinPresets } from '../../core/presets/builtin.js';
import { createServiceCapabilities } from './capabilities.js';

/**
 * Reads the shipped resources and makes the built-in themes and recipes (the preset catalog).
 * Each shipped font is copied into `assets`, the workspace's file store, to get its digest; no
 * workspace record is written. Fails with `unavailable` when the shipped files can't be read, and
 * `invalid-input` at `builtins` when a built-in theme or recipe can't be made.
 */
export async function prepareBuiltins(
  resourceRoot: HostPath,
  tokenRoot: HostPath,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<Result<PreparedBuiltins>> {
  try {
    return await readAndPrepareBuiltins(resourceRoot, tokenRoot, assets);
  } catch {
    return installationUnavailableFailure();
  }
}

/** Reads the shipped resources, then makes the built-in themes and recipes from them. */
async function readAndPrepareBuiltins(
  resourceRoot: HostPath,
  tokenRoot: HostPath,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<Result<PreparedBuiltins>> {
  const tokenFiles = await createTokenFileBindings(tokenRoot);
  if (!tokenFiles.ok) {
    return tokensUnavailableFailure(tokenFiles.error);
  }
  const shippedResources = await import('../../adapters/files/shipped-resources.js');
  const sources = await shippedResources.loadBuiltinSources(resourceRoot, assets, tokenFiles.value);
  if (!sources.ok) {
    return sources;
  }
  const capabilities = createServiceCapabilities(sources.value.tokens);
  return prepareBuiltinPresets(sources.value, capabilities);
}

/** The `unavailable` failure at `installation` for code that threw while reading shipped files. */
function installationUnavailableFailure(): Result<never> {
  return failure(
    'unavailable',
    'installation',
    'Installation resource providers could not initialize',
  );
}

/** The `unavailable` failure at `tokens`, keeping Design System's reason it couldn't read them. */
function tokensUnavailableFailure(tokenFailure: CapabilityFailure): Result<never> {
  return failure('unavailable', 'tokens', tokenFailure.message, tokenFailure);
}
