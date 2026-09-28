/*
 * Why this file exists
 *
 * `--format png` needs an engine that turns a drawn SVG into PNG pixels. Export uses resvg for
 * that, built from a WebAssembly file that ships with Export. Loading it can fail, and SVG output
 * doesn't need it, so it waits until a PNG render asks for it.
 *
 * This file finds that file below the repo folder, compiles it, and starts Export's PNG engine.
 * It only reads; it never writes a file. Mistakes come back as values, never thrown.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { initializeRaster } from '@novakai/canvas-export';
import type { ProviderFault } from '../../contract/records/render-fault.js';
import type { FilePath } from '../../contract/brands.js';
import type { RasterEngine } from '../../contract/ports/render-files.js';
import { providerFailure, type Result } from '../../contract/errors.js';

/**
 * Gives the render its PNG engine, loaded from below `repoRoot` when `prepare` runs. `prepare`
 * fails with `provider-failed` if the file can't be found, read or compiled, or with Export's own
 * finding if the engine won't start.
 */
export function createRasterEngine(repoRoot: FilePath): RasterEngine {
  return {
    prepare: async () => {
      const module = await compile(repoRoot);
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
