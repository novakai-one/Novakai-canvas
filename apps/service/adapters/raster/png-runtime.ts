/*
 * The PNG runtime adapter: compiles the resvg WebAssembly module installed with the service and
 * initializes Export's rasterizer with it. The first preparation's promise is kept and shared by
 * every later PNG request — a failed preparation included — for the life of the runtime.
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeRaster } from '@novakai/canvas-export';
import { failure, type Result } from '../../contract/errors.js';
import type { PngRuntime } from '../../contract/ports/png-runtime.js';

/** A runtime that initializes the rasterizer on the first `prepare` and shares that outcome. */
export function createPngRuntime(): PngRuntime {
  let prepared: Promise<Result<void>> | null = null;
  return {
    prepare: () => {
      prepared ??= initializeNativeRaster();
      return prepared;
    },
  };
}

/** The installed resvg module, compiled and handed to Export; any failure is `unavailable`. */
async function initializeNativeRaster(): Promise<Result<void>> {
  try {
    const require = createRequire(import.meta.url);
    const wasm = await WebAssembly.compile(
      await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')),
    );
    const result = await initializeRaster(wasm);
    return result.ok ? result : failure('unavailable', 'export.png', result.error.message);
  } catch {
    return failure('unavailable', 'export.png', 'PNG export runtime is unavailable');
  }
}
