/*
 * Why this file exists
 *
 * A PNG export needs resvg, a WebAssembly program that turns an SVG drawing into PNG pixels. It
 * ships with the service as a file that must be loaded first. For example, the first
 * `POST /api/v1/export` with `format: 'png'` loads it; later PNG exports reuse it.
 *
 * This file loads resvg once and hands it to Export. Every later request shares that first
 * outcome, even a failure: then the person restores resvg and restarts the service.
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeRaster } from '@novakai/canvas-export';
import { failure, type Result } from '../../contract/errors.js';
import type { PngEncoder } from '../../contract/ports/export.js';

/** `unstarted` until the first `prepare`; `started` holds the one preparation every call shares. */
type RasterPhase =
  | { readonly kind: 'unstarted' }
  | { readonly kind: 'started'; readonly ready: Promise<Result<void>> };

/** The phase once `prepare` has been called. */
type StartedPhase = Extract<RasterPhase, { readonly kind: 'started' }>;

/** The phase before anything was loaded. */
const UNSTARTED: RasterPhase = Object.freeze({ kind: 'unstarted' });

/** The installed resvg WebAssembly file, as a package path. */
const RESVG_WASM = '@resvg/resvg-wasm/index_bg.wasm';

/**
 * Makes the PNG encoder. Its first `prepare` loads resvg; every later call shares that outcome.
 * `prepare` fails with `unavailable` at `export.png` when resvg can't load or Export refuses it.
 */
export function createPngEncoder(): PngEncoder {
  let phase = UNSTARTED;
  return {
    prepare: () => {
      const started = startOnce(phase);
      phase = started;
      return started.ready;
    },
  };
}

/** Keeps a phase that has already started, or starts loading resvg now. */
function startOnce(phase: RasterPhase): StartedPhase {
  if (phase.kind === 'started') {
    return phase;
  }
  const ready = loadResvg();
  return { kind: 'started', ready };
}

/** Compiles the installed resvg module and hands it to Export. */
async function loadResvg(): Promise<Result<void>> {
  try {
    const resvgModule = await compileResvg();
    const initialized = await initializeRaster(resvgModule);
    if (!initialized.ok) {
      return exportRefusedFailure(initialized.error.message);
    }
    return initialized;
  } catch {
    return resvgUnavailableFailure();
  }
}

/** Reads the installed resvg WebAssembly file and compiles it. Throws when it's missing or broken. */
async function compileResvg(): Promise<WebAssembly.Module> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve(RESVG_WASM);
  const wasmBytes = await readFile(wasmPath);
  return WebAssembly.compile(wasmBytes);
}

/** Makes the mistake for a resvg module Export refused, keeping Export's message. */
function exportRefusedFailure(exportMessage: string): Result<never> {
  return failure('unavailable', 'export.png', exportMessage);
}

/** Makes the mistake for a resvg module that can't be found, read or compiled. */
function resvgUnavailableFailure(): Result<never> {
  return failure('unavailable', 'export.png', 'PNG export runtime is unavailable');
}
