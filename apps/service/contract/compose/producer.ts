/*
 * The parent realm's diagram producer: one render worker pool and the reply reader, bound once.
 * The worker entry, the render time limit and the libavoid wasm location are named here. The pool
 * and reader adapters load lazily. The parent owns worker failure and retry; the service keeps
 * the prior scene on any failed job.
 */
import type { DiagramProducer } from '../ports/rendering.js';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import type { HostPath } from '../brands.js';
import { produce } from '../../core/rendering/produce.js';

/** How long one render job, or one worker start-up, may take before it fails `unavailable`. */
const RENDER_TIMEOUT_MS = 30_000;

/** The render worker's process entry. It boots the worker realm through compose/worker.ts. */
const WORKER_ENTRY = new URL('../../cli/render-worker.mjs', import.meta.url);

/** Where the libavoid wasm lives under the installation's resource root. */
const LIBAVOID_WASM = 'vendor/layout/libavoid.wasm';

/**
 * Starts the render worker pool and waits for its first worker. Fails with `unavailable` at
 * `render` ("Rendering bindings could not initialize") when an adapter cannot load or the first
 * worker does not start.
 */
export async function createDiagramProducer(): Promise<Result<DiagramProducer>> {
  try {
    const [worker, output] = await Promise.all([
      import('../../adapters/render-worker/pool.js'),
      import('../../adapters/render-worker/reply-reader.js'),
    ]);
    const transport = worker.createRenderTransport(WORKER_ENTRY, RENDER_TIMEOUT_MS);
    await transport.ready;
    return success({
      produce: (job, signal) =>
        produce(job, signal, transport, { read: output.readRenderDocument }),
    });
  } catch {
    return failure('unavailable', 'render', 'Rendering bindings could not initialize');
  }
}

/** The libavoid wasm path every render job carries, under `resourceRoot`. Never fails. */
export function libavoidWasm(resourceRoot: HostPath): string {
  return `${resourceRoot}/${LIBAVOID_WASM}`;
}
