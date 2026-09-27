/*
 * One render's temporary asset store: a fresh `canvas-render-*` directory under the OS temp root
 * and the Assets store opened inside it. Not pure: creates and removes directories. Failures are
 * values; the headless render removes the directory when it ends, whatever the outcome.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAssets } from '@novakai/canvas-assets';
import { filePath, nativeStep, type FilePath } from '../../contract/records/headless.js';
import type { TempAssets, TempDirectory } from '../../contract/ports/render.js';

/** Build the temporary asset store adapter. */
export function createTempAssets(): TempAssets {
  return {
    create: () =>
      nativeStep(async () =>
        directory(filePath.parse(await mkdtemp(join(tmpdir(), 'canvas-render-')))),
      ),
  };
}

/**
 * The handle over one created directory. `openAssets` returns Assets' own failure whole;
 * `remove` deletes the directory recursively, ignores a missing one, and fails with
 * `provider-failed`.
 */
function directory(path: FilePath): TempDirectory {
  return {
    openAssets: () => openAssets(path),
    remove: () => nativeStep(() => rm(path, { recursive: true, force: true })),
  };
}
