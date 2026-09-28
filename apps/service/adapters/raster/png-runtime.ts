/*
 * The rasterizer adapter: compiles the resvg WebAssembly module installed with the service and
 * initializes Export's rasterizer with it. Impure (module resolution, file read). The first
 * preparation's promise is kept and shared by every later PNG request — a failed preparation
 * included — for the life of the rasterizer; the operator restores the module and restarts the
 * service.
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeRaster } from '@novakai/canvas-export';
import { failure, type Result } from '../../contract/errors.js';
import type { Rasterizer } from '../../contract/ports/export.js';

/** `unstarted` until the first `prepare`; `started` holds the one preparation every call shares. */
type RasterPhase =
  | { readonly kind: 'unstarted' }
  | { readonly kind: 'started'; readonly ready: Promise<Result<void>> };

/** The phase once `prepare` has been called. */
type StartedPhase = Extract<RasterPhase, { readonly kind: 'started' }>;

const UNSTARTED: RasterPhase = Object.freeze({ kind: 'unstarted' });

/**
 * A rasterizer that initializes on the first `prepare` and shares that outcome. `prepare` fails
 * with `unavailable` at `export.png` when the module cannot load or Export refuses it.
 */
export function createRasterizer(): Rasterizer {
  let phase = UNSTARTED;
  return {
    prepare: () => {
      const started = startedPhase(phase);
      phase = started;
      return started.ready;
    },
  };
}

/** The current started phase, or a new one that begins the native initialization now. */
function startedPhase(phase: RasterPhase): StartedPhase {
  if (phase.kind === 'started') return phase;
  return { kind: 'started', ready: initializeNativeRaster() };
}

/**
 * The installed resvg module, compiled and handed to Export. Fails with `unavailable` at
 * `export.png`: Export's message when it refuses the module, otherwise "PNG export runtime is
 * unavailable".
 */
async function initializeNativeRaster(): Promise<Result<void>> {
  try {
    const require = createRequire(import.meta.url);
    const wasm = await WebAssembly.compile(
      await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')),
    );
    const result = await initializeRaster(wasm);
    if (!result.ok) return failure('unavailable', 'export.png', result.error.message);
    return result;
  } catch {
    return failure('unavailable', 'export.png', 'PNG export runtime is unavailable');
  }
}
