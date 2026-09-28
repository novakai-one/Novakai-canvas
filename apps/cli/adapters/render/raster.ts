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
import type { ExportDiagnostic } from '../../contract/records/foreign.js';
import type { FilePath } from '../../contract/brands.js';
import type { RasterEngine } from '../../contract/ports/render-files.js';
import { providerFailure, success, type Result } from '../../contract/errors.js';

/** Where resvg's WebAssembly file sits inside its package. */
const resvgWasmFile = '@resvg/resvg-wasm/index_bg.wasm';

/**
 * Gives the render its PNG engine, loaded from below `repoRoot` when `prepare` runs. `prepare`
 * fails with `provider-failed` if the file can't be found, read or compiled, or with Export's own
 * finding if the engine won't start.
 */
export function createRasterEngine(repoRoot: FilePath): RasterEngine {
  return { prepare: () => startPngEngine(repoRoot) };
}

/** Compiles resvg's WebAssembly file, then starts Export's PNG engine with it. */
async function startPngEngine(
  repoRoot: FilePath,
): Promise<Result<void, ProviderFault | ExportDiagnostic>> {
  const resvgModule = await compileResvg(repoRoot);
  if (!resvgModule.ok) {
    return resvgModule;
  }
  return initializeRaster(resvgModule.value);
}

/** Finds resvg's WebAssembly file through Export's own packages, reads it and compiles it. */
async function compileResvg(
  repoRoot: FilePath,
): Promise<Result<WebAssembly.Module, ProviderFault>> {
  try {
    const wasmPath = findResvgWasm(repoRoot);
    const wasmBytes = await readFile(wasmPath);
    const resvgModule = await WebAssembly.compile(wasmBytes);
    return success(resvgModule);
  } catch (thrown) {
    return providerFailure(thrown);
  }
}

/** Finds resvg's WebAssembly file the way Export's own code would. Throws if it isn't installed. */
function findResvgWasm(repoRoot: FilePath): string {
  const exportPackage = join(repoRoot, 'capability/export/package.json');
  const requireFromExport = createRequire(exportPackage);
  return requireFromExport.resolve(resvgWasmFile);
}
