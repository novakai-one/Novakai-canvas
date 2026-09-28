/*
 * PNG raster start-up for the headless render: compile the resvg wasm module that ships with
 * Export and initialise Export's raster runtime. Not pure: reads the wasm file. Failures are
 * values: `provider-failed` for the file or compile step, Export's own diagnostic for start-up.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { initializeRaster } from '@novakai/canvas-export';
import type { ProviderFault } from '../../contract/records/render-fault.js';
import type { FilePath } from '../../contract/brands.js';
import type { RasterEngine } from '../../contract/ports/render-files.js';
import { providerFailure, type Result } from '../../contract/errors.js';

/** Build the raster engine for one repo root. Touches nothing until `prepare` runs. */
export function createRaster(root: FilePath): RasterEngine {
  return {
    prepare: async () => {
      const module = await compile(root);
      if (!module.ok) return module;
      return initializeRaster(module.value);
    },
  };
}

/**
 * Resolve resvg's wasm file from Export's own dependencies and compile it. A resolve, read or
 * compile throw becomes `provider-failed`.
 */
async function compile(root: FilePath): Promise<Result<WebAssembly.Module, ProviderFault>> {
  try {
    const require = createRequire(join(root, 'capability/export/package.json'));
    const wasm = await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm'));
    return { ok: true, value: await WebAssembly.compile(wasm) };
  } catch (error) {
    return providerFailure(error);
  }
}
