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
import type { OperationSource } from '../records/transport/failure-source.js';

/**
 * Starts serving render jobs in this worker realm.
 *
 * Steps:
 * 1. Load the worker entry, the job reader and the diagram derivation.
 * 2. Prepare the native runtimes; on failure, report it to the parent before returning it.
 * 3. Serve jobs; the entry posts the ready handshake.
 *
 * Fails with `unavailable` at `worker` when a native runtime cannot prepare (that owner's failure
 * kept as source) or an adapter cannot load ("Rendering worker could not initialize"; nothing is
 * reported, so the parent sees the realm exit), and with `invalid-input` at `worker` when this is
 * not a worker realm.
 */
export async function runRenderWorker(): Promise<Result<void>> {
  try {
    const [workerEntry, jobReader, derive] = await Promise.all([
      import('../../adapters/render-worker/entry.js'),
      import('../../adapters/render-worker/job-reader.js'),
      import('../../adapters/render-worker/derive.js'),
    ]);
    const prepared = await prepareNativeRuntimes();
    if (!prepared.ok) {
      workerEntry.reportStartupFailure(prepared.error);
      return prepared;
    }
    return workerEntry.serveRenderWorker({
      producer: { produce: derive.produceDiagram },
      read: jobReader.readRenderingJob,
    });
  } catch {
    return failure('unavailable', 'worker', 'Rendering worker could not initialize');
  }
}

/**
 * Prepares native measurement, then the layout runtime. Fails with `unavailable` at `worker`
 * carrying the first owner failure as source; the layout runtime is not prepared after a
 * presentation failure.
 */
async function prepareNativeRuntimes(): Promise<Result<void>> {
  const presentation = await prepareNativePresentation();
  if (!presentation.ok) return runtimeNotPrepared(presentation.error);
  const layout = await prepareLayoutRuntime();
  if (!layout.ok) return runtimeNotPrepared(layout.error);
  return success(undefined);
}

/** `unavailable` at `worker` with the runtime owner's message, and its failure kept as source. */
function runtimeNotPrepared(error: OperationSource): Result<void> {
  return failure('unavailable', 'worker', error.message, error);
}
