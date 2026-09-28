/*
 * The render worker pool: node:worker_threads realms that run one render job at a time. One
 * initialized worker waits idle between jobs; a concurrent job starts its own worker, and a worker
 * not kept as the idle one is terminated when its job settles. Impure (threads, timers).
 * Cancellation, a crash, an early exit or the time limit terminates that job's worker; the parent
 * (compose/producer.ts) keeps the prior scene and the caller retries.
 */
import { Worker as NodeWorker } from 'node:worker_threads';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import type { RenderTransport } from '../../contract/ports/rendering.js';
import { resultEnvelope, workerHandshake } from '../../contract/records/rendering/worker.js';
import { failure, success, type Result } from '../../contract/errors.js';
import type { OperationSource } from '../../contract/records/transport/failure-source.js';

/** A started worker and the outcome of its start-up handshake. */
interface WorkerSlot {
  readonly worker: NodeWorker;
  readonly ready: Promise<Result<void>>;
}

/** The pool's idle worker: `none`, or one initialized worker waiting for the next job. */
type IdleWorker = { readonly kind: 'none' } | { readonly kind: 'ready'; readonly slot: WorkerSlot };

/** A job's answer, and whether its worker is kept for the next job (`reuse`) or terminated. */
interface JobEnd {
  readonly result: Result<unknown>;
  readonly settlement: 'reuse' | 'terminate';
}

/** What one job runs with: the idle-worker hand-off and the time limit. */
interface Pool {
  /** The idle worker, or a new one when none is idle; no worker is idle afterwards. */
  readonly take: () => WorkerSlot;
  /** Keeps `slot` as the idle worker when none is idle; otherwise terminates it. */
  readonly release: (slot: WorkerSlot) => void;
  readonly timeoutMs: number;
}

const NO_IDLE: IdleWorker = Object.freeze({ kind: 'none' });

/**
 * Starts the pool with one idle worker; `ready` answers once it has loaded, or `unavailable` at
 * `worker` when it reports a startup failure, fails, exits or exceeds `timeoutMs` during start-up. `entry` is the worker
 * realm's script; compose names it. `run` fails with `cancelled` at `worker` when the signal
 * aborts, and `unavailable` at `worker` when a worker cannot start, fails, exits, exceeds
 * `timeoutMs` or returns a malformed result.
 */
export function createRenderTransport(
  entry: URL,
  timeoutMs: number,
): RenderTransport & { readonly ready: Promise<Result<void>> } {
  let idle = NO_IDLE;
  const retire = (worker: NodeWorker): void => {
    if (idle.kind === 'ready' && idle.slot.worker === worker) idle = NO_IDLE;
  };
  const take = (): WorkerSlot => {
    const current = idle;
    idle = NO_IDLE;
    if (current.kind === 'ready') return current.slot;
    return startWorker(entry, timeoutMs, retire);
  };
  const release = (slot: WorkerSlot): void => {
    if (idle.kind === 'ready') {
      void slot.worker.terminate();
      return;
    }
    slot.worker.unref();
    idle = { kind: 'ready', slot };
  };
  const first = take();
  release(first);
  return {
    ready: first.ready,
    run: (job, signal) => runJob(job, signal, { take, release, timeoutMs }),
  };
}

/**
 * Starts one worker realm, unreferenced so a waiting worker never keeps the process alive.
 * `retire` hears its crash or exit. Its `ready` answers as `initialized` names.
 */
function startWorker(
  entry: URL,
  timeoutMs: number,
  retire: (worker: NodeWorker) => void,
): WorkerSlot {
  const worker = new NodeWorker(entry, { execArgv: [] });
  const gone = (): void => retire(worker);
  worker.on('error', gone);
  worker.on('exit', gone);
  worker.unref();
  return { worker, ready: initialized(worker, timeoutMs) };
}

/**
 * Waits for the worker's start-up handshake; the worker loads code only and never computes a
 * diagram. Fails with `unavailable` at `worker` as `readHandshake` names for the first message,
 * or when the worker fails, exits or exceeds `timeoutMs` (the worker is then terminated).
 */
function initialized(
  worker: NodeWorker,
  timeoutMs: number,
): Promise<Result<void>> {
  return new Promise((resolve) => {
    function finish(startup: Result<void>): void {
      clearTimeout(timer);
      worker.removeListener('message', answered);
      worker.removeListener('error', failed);
      worker.removeListener('exit', exited);
      resolve(startup);
    }
    function answered(input: unknown): void {
      finish(readHandshake(input));
    }
    function failed(): void {
      finish(notReady('Rendering worker initialization failed'));
    }
    function exited(): void {
      finish(notReady('Rendering worker exited during initialization'));
    }
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(notReady('Rendering worker initialization timed out'));
    }, timeoutMs);
    worker.once('message', answered);
    worker.once('error', failed);
    worker.once('exit', exited);
  });
}

/**
 * The worker's first message read as its start-up handshake. Fails with `unavailable` at `worker`
 * when the message is not a handshake ("Invalid rendering worker initialization"), or when the
 * worker reports it could not start (its failure kept as source).
 */
function readHandshake(input: unknown): Result<void> {
  const handshake = workerHandshake.safeParse(input);
  if (!handshake.success) return notReady('Invalid rendering worker initialization');
  if (!handshake.data.ready) return startupRefused(handshake.data.error);
  return success(undefined);
}

/** A failed handshake: `unavailable` at `worker`. */
function notReady(message: string): Result<void> {
  return failure('unavailable', 'worker', message);
}

/** The worker's reported startup failure: `unavailable` at `worker`, `error` kept as source. */
function startupRefused(error: OperationSource): Result<void> {
  return failure('unavailable', 'worker', 'Rendering worker reported a startup failure', error);
}

/**
 * Runs one job on the idle worker, or on a new one. Fails with `unavailable` at `worker`
 * ("Rendering worker could not start") when the worker cannot start; otherwise as `observe`.
 */
async function runJob(
  job: RenderingJob,
  signal: AbortSignal,
  pool: Pool,
): Promise<Result<unknown>> {
  try {
    const slot = pool.take();
    const ready = await slot.ready;
    if (!ready.ok) return notStarted();
    return await observe(slot.worker, job, signal, pool.timeoutMs, () => pool.release(slot));
  } catch {
    return notStarted();
  }
}

/** A job whose worker could not start: `unavailable` at `worker`. */
function notStarted(): Result<unknown> {
  return failure('unavailable', 'worker', 'Rendering worker could not start');
}

/**
 * Posts the job and answers with the worker's first outcome: a reply (worker reused through
 * `release`), or an error, exit, time limit or cancellation (worker terminated). The first outcome
 * removes the timer and every listener, so the job settles once. Fails with `cancelled` at
 * `worker` when the signal aborts, and `unavailable` at `worker` on a failure, an early exit, the
 * time limit, a malformed reply or an unconfirmed termination.
 */
function observe(
  worker: NodeWorker,
  job: RenderingJob,
  signal: AbortSignal,
  timeoutMs: number,
  release: () => void,
): Promise<Result<unknown>> {
  return new Promise((resolve) => {
    function finish(end: JobEnd): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.removeListener('message', message);
      worker.removeListener('error', error);
      worker.removeListener('exit', exited);
      void settle(worker, end, release).then(resolve);
    }
    function message(input: unknown): void {
      finish({ result: reply(input), settlement: 'reuse' });
    }
    function error(): void {
      finish(terminate('Rendering worker failed'));
    }
    function exited(): void {
      finish(terminate('Rendering worker ended without a result'));
    }
    function cancel(): void {
      finish({
        result: failure('cancelled', 'worker', 'Rendering was cancelled'),
        settlement: 'terminate',
      });
    }
    const timer = setTimeout(
      () => finish(terminate('Rendering exceeded its time limit')),
      timeoutMs,
    );
    worker.once('message', message);
    worker.once('error', error);
    worker.once('exit', exited);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    worker.ref();
    worker.postMessage(job);
  });
}

/** An `unavailable` answer at `worker` whose worker is terminated. */
function terminate(message: string): JobEnd {
  return { result: failure('unavailable', 'worker', message), settlement: 'terminate' };
}

/**
 * Hands a `reuse` worker back to the pool at once, or terminates a `terminate` worker first.
 * Answers the job's result; an unconfirmed termination is `unavailable` at `worker`.
 */
async function settle(
  worker: NodeWorker,
  end: JobEnd,
  release: () => void,
): Promise<Result<unknown>> {
  if (end.settlement === 'terminate') return terminated(worker, end.result);
  release();
  return end.result;
}

/** `result` once the worker has terminated; `unavailable` at `worker` when that is not confirmed. */
function terminated(
  worker: NodeWorker,
  result: Result<unknown>,
): Promise<Result<unknown>> {
  return worker.terminate().then(
    () => result,
    () => failure('unavailable', 'worker', 'Worker termination could not be confirmed'),
  );
}

/**
 * The worker's reply as a result envelope; its value stays unknown until the reply reader
 * rebuilds the scene. Fails with `unavailable` at `worker` when the reply is malformed.
 */
function reply(input: unknown): Result<unknown> {
  const parsed = resultEnvelope.safeParse(input);
  if (!parsed.success)
    return failure('unavailable', 'worker', 'Rendering worker returned a malformed result');
  return parsed.data;
}
