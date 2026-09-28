/*
 * Why this file exists
 *
 * Drawing a diagram runs on render worker threads, so a slow layout never blocks the server. The
 * service needs one pool of those workers, started before the first request, and a way to check
 * what they send back.
 *
 * This file starts that pool and joins it to the reply checker, as one `DiagramProducer`. It also
 * names the worker's start file, the 30-second time limit, and where libavoid (the library that
 * routes wires) keeps its WebAssembly file.
 */
import type { DiagramProducer } from '../ports/rendering.js';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import { hostPath, type HostPath } from '../brands.js';
import { runRenderJob } from '../../core/rendering/produce.js';

/** How long one render job, or one worker start-up, may take before it fails `unavailable`. */
const RENDER_TIMEOUT_MS = 30_000;

/** The render worker's process entry. It boots the worker realm through compose/worker.ts. */
const WORKER_ENTRY = new URL('../../cli/render-worker.mjs', import.meta.url);

/** Where libavoid's WebAssembly file lives inside the resource folder. */
const LIBAVOID_WASM = 'vendor/layout/libavoid.wasm';

/**
 * Starts the render worker pool and waits until its first worker is ready. Answers the pool joined
 * to the reply check, as one `DiagramProducer`. Fails with `unavailable` at `render` when the
 * worker code can't load or the first worker doesn't start.
 */
export async function startRenderWorkers(): Promise<Result<DiagramProducer>> {
  try {
    const [worker, output] = await Promise.all([
      import('../../adapters/render-worker/pool.js'),
      import('../../adapters/render-worker/reply-reader.js'),
    ]);
    const transport = worker.startRenderWorkerPool(WORKER_ENTRY, RENDER_TIMEOUT_MS);
    const ready = await transport.ready;
    if (!ready.ok) return notInitialized();
    return success({
      produce: (job, signal) =>
        runRenderJob(job, signal, transport, { read: output.readRenderDocument }),
    });
  } catch {
    return notInitialized();
  }
}

/**
 * The path of libavoid's WebAssembly file inside the resource folder. Every render job carries it.
 */
export function libavoidWasmPath(resourceRoot: HostPath): HostPath {
  return hostPath.parse(`${resourceRoot}/${LIBAVOID_WASM}`);
}

/** `unavailable` at `render`: the pool or reader could not load, or the first worker did not start. */
function notInitialized(): Result<DiagramProducer> {
  return failure('unavailable', 'render', 'Rendering bindings could not initialize');
}
