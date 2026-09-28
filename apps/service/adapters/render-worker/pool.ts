/*
 * Why this file exists
 *
 * Drawing a diagram can be slow, or can crash, so each drawing runs on a worker thread of its own.
 * For example, two `GET /api/v1/render` requests at once run on two threads, and a drawing that
 * runs past its time limit is stopped without harming the server.
 *
 * This file keeps those threads. One ready thread waits between jobs; an extra job starts its own
 * thread, which ends with its job. Cancelling, a crash or the time limit ends that job's thread.
 * It checks only the outer shape of a reply; reply-reader.ts checks the drawing.
 */
import { Worker as NodeWorker } from 'node:worker_threads';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import type { RenderTransport } from '../../contract/ports/rendering.js';
import { workerReplyMessage, workerHandshake } from '../../contract/records/rendering/worker.js';
import { failure, success, type Result } from '../../contract/errors.js';
import type { CapabilityFailure } from '../../contract/records/transport/failure-source.js';

/** The render worker pool: `run` sends a job to a free worker and answers its unchecked reply. */
export interface RenderWorkerPool extends RenderTransport {
  /** Answers once the first worker has started, or `unavailable` at `worker` when it can't. */
  readonly ready: Promise<Result<void>>;
}

/** A started worker, and the answer to whether it is ready for jobs. */
interface WorkerSlot {
  readonly worker: NodeWorker;
  readonly ready: Promise<Result<void>>;
}

/** The pool's idle worker: `none`, or one ready worker waiting for the next job. */
type IdleWorker = { readonly kind: 'none' } | { readonly kind: 'ready'; readonly slot: WorkerSlot };

/** The pool: the worker waiting for the next job (the one part that changes), and how to start one. */
interface Pool {
  idle: IdleWorker;
  readonly workerScript: URL;
  readonly timeoutMs: number;
}

/** How a job ended: its answer, and whether its worker is kept for the next job or ended. */
interface JobEnd {
  readonly answer: Result<unknown>;
  readonly settlement: 'reuse' | 'terminate';
}

/** No worker is waiting. */
const NO_IDLE: IdleWorker = Object.freeze({ kind: 'none' });

/** Each way a worker can fail, and what its `unavailable` mistake at `worker` says. */
const WORKER_MISTAKES = Object.freeze({
  'start-crashed': 'Rendering worker initialization failed',
  'start-exited': 'Rendering worker exited during initialization',
  'start-timed-out': 'Rendering worker initialization timed out',
  'bad-handshake': 'Invalid rendering worker initialization',
  'not-started': 'Rendering worker could not start',
  crashed: 'Rendering worker failed',
  exited: 'Rendering worker ended without a result',
  'timed-out': 'Rendering exceeded its time limit',
  'end-unconfirmed': 'Worker termination could not be confirmed',
  'bad-reply': 'Rendering worker returned a malformed result',
});

/** One way a worker can fail; see `WORKER_MISTAKES`. */
type WorkerMistake = keyof typeof WORKER_MISTAKES;

/**
 * Starts the render worker pool, with one worker that waits for the first job. `workerScript` is
 * the file each worker thread runs (compose names it).
 * Mistakes from `run`: `cancelled` at `worker` when the job is cancelled; `unavailable` at `worker`
 * when a worker can't start, crashes, exits, runs past `timeoutMs` or sends a malformed reply.
 */
export function startRenderWorkerPool(
  workerScript: URL,
  timeoutMs: number,
): RenderWorkerPool {
  const pool: Pool = { idle: NO_IDLE, workerScript, timeoutMs };
  const firstWorker = takeWorker(pool);
  releaseWorker(pool, firstWorker);
  return {
    ready: firstWorker.ready,
    run: (job, signal) => runJob(job, signal, pool),
  };
}

/** Hands out the waiting worker, or starts a new one when none is waiting. */
function takeWorker(pool: Pool): WorkerSlot {
  const waiting = pool.idle;
  pool.idle = NO_IDLE;
  if (waiting.kind === 'ready') {
    return waiting.slot;
  }
  return startWorker(pool);
}

/** Keeps the worker waiting for the next job when none is waiting; otherwise ends its thread. */
function releaseWorker(
  pool: Pool,
  slot: WorkerSlot,
): void {
  if (pool.idle.kind === 'ready') {
    void slot.worker.terminate();
    return;
  }
  slot.worker.unref();
  pool.idle = { kind: 'ready', slot };
}

/** Forgets the waiting worker when it is the one that crashed or exited. */
function retireWorker(
  pool: Pool,
  worker: NodeWorker,
): void {
  const waiting = pool.idle;
  if (waiting.kind === 'ready' && waiting.slot.worker === worker) {
    pool.idle = NO_IDLE;
  }
}

/**
 * Starts one worker thread, and waits for it to say it is ready. The pool forgets it if it
 * crashes or exits. A waiting thread never keeps the process alive.
 */
function startWorker(pool: Pool): WorkerSlot {
  const worker = new NodeWorker(pool.workerScript, { execArgv: [] });
  const forgetWorker = (): void => retireWorker(pool, worker);
  worker.on('error', forgetWorker);
  worker.on('exit', forgetWorker);
  worker.unref();
  const ready = waitUntilReady(worker, pool.timeoutMs);
  return { worker, ready };
}

/**
 * Waits for the thread's first message. A crash, an early exit or the time limit (which also ends
 * the thread) ends the wait with a mistake. Whatever comes first stops the rest.
 */
function waitUntilReady(
  worker: NodeWorker,
  timeoutMs: number,
): Promise<Result<void>> {
  return new Promise((resolve) => {
    const finish = (startup: Result<void>): void => {
      clearTimeout(timer);
      worker.removeListener('message', answered);
      worker.removeListener('error', crashed);
      worker.removeListener('exit', exited);
      resolve(startup);
    };
    const answered = (message: unknown): void => finish(readHandshake(message));
    const crashed = (): void => finish(workerFailure('start-crashed'));
    const exited = (): void => finish(workerFailure('start-exited'));
    const timedOut = (): void => {
      void worker.terminate();
      finish(workerFailure('start-timed-out'));
    };
    const timer = setTimeout(timedOut, timeoutMs);
    worker.once('message', answered);
    worker.once('error', crashed);
    worker.once('exit', exited);
  });
}

/** Reads the thread's first message: ready, or the reason it couldn't start. */
function readHandshake(message: unknown): Result<void> {
  const handshake = workerHandshake.safeParse(message);
  if (!handshake.success) {
    return workerFailure('bad-handshake');
  }
  if (!handshake.data.ready) {
    return startupRefusedFailure(handshake.data.error);
  }
  return success(undefined);
}

/** Runs one job on the waiting worker, or on a new one, once that worker is ready. */
async function runJob(
  job: RenderingJob,
  signal: AbortSignal,
  pool: Pool,
): Promise<Result<unknown>> {
  try {
    const slot = takeWorker(pool);
    const ready = await slot.ready;
    if (!ready.ok) {
      return workerFailure('not-started');
    }
    return await runOnWorker(slot, job, signal, pool);
  } catch {
    return workerFailure('not-started');
  }
}

/**
 * Sends the job to the worker, and answers with whatever happens first: its reply, a crash, an
 * early exit, cancelling or the time limit. The first one settles the job; the rest are ignored.
 */
function runOnWorker(
  slot: WorkerSlot,
  job: RenderingJob,
  signal: AbortSignal,
  pool: Pool,
): Promise<Result<unknown>> {
  const { worker } = slot;
  return new Promise((resolve) => {
    const finish = (end: JobEnd): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      worker.removeListener('message', replied);
      worker.removeListener('error', crashed);
      worker.removeListener('exit', exited);
      void settleJob(slot, end, pool).then(resolve);
    };
    const replied = (message: unknown): void => finish(keepWorkerWith(readReply(message)));
    const crashed = (): void => finish(endThreadWith(workerFailure('crashed')));
    const exited = (): void => finish(endThreadWith(workerFailure('exited')));
    const cancelled = (): void => finish(endThreadWith(cancelledFailure()));
    const timedOut = (): void => finish(endThreadWith(workerFailure('timed-out')));
    const timer = setTimeout(timedOut, pool.timeoutMs);
    worker.once('message', replied);
    worker.once('error', crashed);
    worker.once('exit', exited);
    signal.addEventListener('abort', cancelled, { once: true });
    // A signal that aborted before the job was sent never fires 'abort', so it is checked by hand.
    if (signal.aborted) {
      cancelled();
      return;
    }
    worker.ref();
    worker.postMessage(job);
  });
}

/** Ends a job with this answer, and keeps its worker for the next job. */
function keepWorkerWith(answer: Result<unknown>): JobEnd {
  return { answer, settlement: 'reuse' };
}

/** Ends a job with this answer, and ends its worker's thread. */
function endThreadWith(answer: Result<unknown>): JobEnd {
  return { answer, settlement: 'terminate' };
}

/** Gives a kept worker back to the pool, or ends the thread first; then answers the job. */
async function settleJob(
  slot: WorkerSlot,
  end: JobEnd,
  pool: Pool,
): Promise<Result<unknown>> {
  if (end.settlement === 'terminate') {
    return endThread(slot.worker, end.answer);
  }
  releaseWorker(pool, slot);
  return end.answer;
}

/** Ends the worker's thread, then gives the job's answer, unless the end can't be confirmed. */
async function endThread(
  worker: NodeWorker,
  answer: Result<unknown>,
): Promise<Result<unknown>> {
  try {
    await worker.terminate();
    return answer;
  } catch {
    return workerFailure('end-unconfirmed');
  }
}

/** Reads the worker's reply as an answer; reply-reader.ts checks what it holds later. */
function readReply(message: unknown): Result<unknown> {
  const reply = workerReplyMessage.safeParse(message);
  if (!reply.success) {
    return workerFailure('bad-reply');
  }
  return reply.data;
}

/** Makes the `unavailable` mistake at `worker` for one way a worker can fail. */
function workerFailure(mistake: WorkerMistake): Result<never> {
  return failure('unavailable', 'worker', WORKER_MISTAKES[mistake]);
}

/** Makes the mistake for a thread that said it couldn't start, keeping its reason. */
function startupRefusedFailure(reason: CapabilityFailure): Result<never> {
  return failure('unavailable', 'worker', 'Rendering worker reported a startup failure', reason);
}

/** Makes the mistake for a job that was cancelled. */
function cancelledFailure(): Result<never> {
  return failure('cancelled', 'worker', 'Rendering was cancelled');
}
