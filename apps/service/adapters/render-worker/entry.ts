/*
 * Why this file exists
 *
 * A render worker thread gets its jobs as messages from the server, and sends each answer back the
 * same way. For example, the server sends the job for `my-diagram`; the worker sends back the drawn
 * document, or the mistake it found.
 *
 * This file is the worker thread's side of that exchange. It says it is ready (or why it can't
 * start), then answers each job it is sent. It never cancels a job itself: the server stops a job
 * by ending the thread.
 */
import { parentPort, type MessagePort } from 'node:worker_threads';
import type { Diagnostic, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import type { DiagramProducer } from '../../contract/ports/rendering.js';
import type { RenderDocument, RenderingJob } from '../../contract/records/rendering/job.js';
import { READY_HANDSHAKE, type WorkerHandshake } from '../../contract/records/rendering/worker.js';

/** What the worker thread answers jobs with. compose/worker.ts passes them. */
export interface RenderWorkerDependencies {
  /** Draws a checked job (derive.ts). */
  readonly producer: DiagramProducer;
  /** Checks a job message as it arrives (job-reader.ts). */
  readJob(message: unknown): Result<RenderingJob>;
}

/**
 * The signal every job in this realm renders under. It never aborts: the parent cancels a job by
 * terminating the realm.
 */
const WORKER_REALM_SIGNAL: AbortSignal = new AbortController().signal;

/**
 * Tells the server this worker thread is ready, then answers each job it sends: the drawn
 * document, or the mistake found. Fails with `invalid-input` at `worker` when called outside a
 * worker thread (a bug).
 */
export async function serveRenderWorker(
  dependencies: RenderWorkerDependencies,
): Promise<Result<void>> {
  const port = parentPort;
  if (port === null) {
    return outsideWorkerFailure();
  }
  answerJobs(port, dependencies);
  port.postMessage(READY_HANDSHAKE);
  return success(undefined);
}

/**
 * Tells the server this worker thread could not start, and why (`reason`). The server's start-up
 * then fails with `unavailable`, keeping `reason` as the source. Does nothing outside a worker
 * thread, where no server listens.
 */
export function reportStartupFailure(reason: Diagnostic): void {
  const port = parentPort;
  if (port === null) {
    return;
  }
  const refusal: WorkerHandshake = { ready: false, error: reason };
  port.postMessage(refusal);
}

/** Answers each job message the server sends with the drawn document, or the mistake found. */
function answerJobs(
  port: MessagePort,
  dependencies: RenderWorkerDependencies,
): void {
  port.on('message', async (message: unknown) => {
    const answer = await drawJob(message, dependencies);
    port.postMessage(answer);
  });
}

/** Checks the job message, then draws it. A bad job answers its mistake and is never drawn. */
async function drawJob(
  message: unknown,
  dependencies: RenderWorkerDependencies,
): Promise<Result<RenderDocument>> {
  const job = dependencies.readJob(message);
  if (!job.ok) {
    return job;
  }
  return dependencies.producer.produce(job.value, WORKER_REALM_SIGNAL);
}

/** Makes the mistake for a worker entry that runs outside a worker thread (a bug). */
function outsideWorkerFailure(): Result<never> {
  return failure('invalid-input', 'worker', 'Rendering entry requires a worker realm');
}
