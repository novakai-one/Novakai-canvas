/*
 * One render's temporary asset store: a fresh `canvas-render-*` directory under the OS temp root
 * and the Assets store opened inside it. Not pure: creates and removes directories. Failures are
 * values; the headless render removes the directory when it ends, whatever the outcome.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAssets } from '@novakai/canvas-assets';
import { nativeFault, type ProviderFault } from '../../contract/records/headless.js';
import { filePath, type FilePath } from '../../contract/brands.js';
import type { TempAssets, TempDirectory } from '../../contract/ports/render.js';
import type { Result } from '../../contract/errors.js';

/** Build the temporary asset store adapter. */
export function createTempAssets(): TempAssets {
  return { create };
}

/** Create a fresh directory under the OS temp root. A throw becomes `provider-failed`. */
async function create(): Promise<Result<TempDirectory, ProviderFault>> {
  try {
    const path = await mkdtemp(join(tmpdir(), 'canvas-render-'));
    return { ok: true, value: directory(filePath.parse(path)) };
  } catch (error) {
    return { ok: false, error: nativeFault(error) };
  }
}

/** The handle over one created directory. `openAssets` returns Assets' own failure whole. */
function directory(path: FilePath): TempDirectory {
  return {
    openAssets: () => openAssets(path),
    remove: () => remove(path),
  };
}

/**
 * Delete the directory and all it holds; a missing one is not a failure. Fails with
 * `provider-failed`.
 */
async function remove(path: FilePath): Promise<Result<void, ProviderFault>> {
  try {
    await rm(path, { recursive: true, force: true });
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: nativeFault(error) };
  }
}
