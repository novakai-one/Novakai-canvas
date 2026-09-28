/*
 * Why this file exists
 *
 * A render worker thread starts empty. Before it can take a job, it must load the compiled code
 * that measures text and lays out diagrams. Then it tells the server it is ready, or why it can't
 * start.
 *
 * This file does that start-up for one worker thread. The worker's start file loads only this file,
 * so a worker never loads the web server, storage or Authoring. The server decides what to do when
 * a worker fails (compose/producer.ts).
 */
import { prepareLayoutRuntime } from '@novakai/canvas-layout';
import { prepareNativePresentation } from '@novakai/canvas-presentation';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import type { CapabilityFailure } from '../records/transport/failure-source.js';

/**
 * Starts this worker thread taking render jobs.
 *
 * 1. Load the worker's code.
 * 2. Prepare the compiled text and layout code; if that fails, tell the server why.
 * 3. Tell the server it is ready, and take jobs.
 *
 * Fails with `unavailable` at `worker` when the compiled or worker code can't load.
 * `invalid-input` at `worker` means this is not a worker thread. That is a bug guard: only
 * cli/render-worker.mjs calls this.
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
function runtimeNotPrepared(error: CapabilityFailure): Result<void> {
  return failure('unavailable', 'worker', error.message, error);
}
