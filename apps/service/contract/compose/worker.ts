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
import type * as WorkerEntry from '../../adapters/render-worker/entry.js';
import type * as JobReader from '../../adapters/render-worker/job-reader.js';
import type * as CompiledLayout from '../../adapters/render-worker/derive.js';

/**
 * Starts this worker thread taking render jobs.
 *
 * 1. Load the worker's code and prepare the compiled text and layout code; if that fails, tell the
 *    server why.
 * 2. Tell the server it is ready, and take jobs.
 *
 * Fails with `unavailable` at `worker` when the compiled or worker code can't load, or with
 * `invalid-input` at `worker` if called outside a worker thread (a bug).
 */
export async function runRenderWorker(): Promise<Result<void>> {
  const workerCode = await prepareWorkerCode();
  if (!workerCode.ok) {
    return workerCode;
  }
  return serveJobs(workerCode.value);
}

/** The worker's loaded code: its entry, its job check, and the layout code that draws a job. */
interface WorkerCode {
  readonly entry: typeof WorkerEntry;
  readonly jobReader: typeof JobReader;
  readonly layout: typeof CompiledLayout;
}

/** Loads the worker's code and prepares the compiled code; a throw becomes `unavailable`. */
async function prepareWorkerCode(): Promise<Result<WorkerCode>> {
  try {
    return await importThenPrepareRuntimes();
  } catch {
    return workerUnavailableFailure();
  }
}

/** Imports the worker's code, then prepares the compiled code, telling the server if that fails. */
async function importThenPrepareRuntimes(): Promise<Result<WorkerCode>> {
  const [entry, jobReader, layout] = await Promise.all([
    import('../../adapters/render-worker/entry.js'),
    import('../../adapters/render-worker/job-reader.js'),
    import('../../adapters/render-worker/derive.js'),
  ]);
  const prepared = await prepareNativeRuntimes();
  if (!prepared.ok) {
    entry.reportStartupFailure(prepared.error);
    return prepared;
  }
  return success({ entry, jobReader, layout });
}

/** Tells the server this worker is ready, then answers every job it sends. */
function serveJobs(workerCode: WorkerCode): Promise<Result<void>> {
  return workerCode.entry.serveRenderWorker({
    producer: { produce: workerCode.layout.produceDiagram },
    readJob: workerCode.jobReader.readRenderingJob,
  });
}

/** Prepares native text measurement, then the layout runtime, stopping at the first failure. */
async function prepareNativeRuntimes(): Promise<Result<void>> {
  const presentation = await prepareNativePresentation();
  if (!presentation.ok) {
    return runtimeNotPreparedFailure(presentation.error);
  }
  const layout = await prepareLayoutRuntime();
  if (!layout.ok) {
    return runtimeNotPreparedFailure(layout.error);
  }
  return success(undefined);
}

/** The `unavailable` failure at `worker` for worker code that threw while loading or preparing. */
function workerUnavailableFailure(): Result<never> {
  return failure('unavailable', 'worker', 'Rendering worker could not initialize');
}

/** The `unavailable` failure at `worker`, keeping the compiled code's own reason it can't start. */
function runtimeNotPreparedFailure(runtimeFailure: CapabilityFailure): Result<never> {
  return failure('unavailable', 'worker', runtimeFailure.message, runtimeFailure);
}
