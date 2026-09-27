/*
 * The render worker realm's composition root: prepare the native measurement and layout runtimes,
 * then serve render jobs over the worker port. `cli/render-worker.mjs` loads this file only, so the
 * worker realm never loads the HTTP, storage or Authoring wiring. The parent (compose/producer.ts)
 * owns worker failure and retry and keeps the prior scene when the worker cannot start.
 */
import { prepareLayoutRuntime } from '@novakai/canvas-layout';
import { prepareNativePresentation } from '@novakai/canvas-presentation';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';

/**
 * Starts serving render jobs in this worker realm. Fails with `unavailable` at `worker` when a
 * native runtime cannot prepare (that owner's failure kept as source) or an adapter cannot load
 * ("Rendering worker could not initialize"), and with `invalid-input` at `worker` when this is not
 * a worker realm.
 */
export async function runRenderWorker(): Promise<Result<void>> {
  try {
    const [entry, input, rendering] = await Promise.all([
      import('../../adapters/render-worker/entry.js'),
      import('../../adapters/render-worker/job-reader.js'),
      import('../../adapters/render-worker/derive.js'),
    ]);
    const prepared = await prepareNativeRuntimes();
    if (!prepared.ok) return prepared;
    return entry.serveRenderWorker({
      producer: { produce: rendering.produceDiagram },
      read: input.readRenderingJob,
    });
  } catch {
    return failure('unavailable', 'worker', 'Rendering worker could not initialize');
  }
}

/**
 * Prepares native measurement and the layout runtime together. Fails with `unavailable` at
 * `worker` carrying the first owner failure as source.
 */
async function prepareNativeRuntimes(): Promise<Result<void>> {
  const prepared = await Promise.all([prepareNativePresentation(), prepareLayoutRuntime()]);
  const failed = prepared.find((result) => !result.ok);
  if (failed && !failed.ok) {
    return failure('unavailable', 'worker', failed.error.message, failed.error);
  }
  return success(undefined);
}
