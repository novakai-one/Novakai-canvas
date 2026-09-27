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
import { resultEnvelope } from '../../contract/records/rendering/worker.js';
import { failure, success, type Result } from '../../contract/errors.js';

/** A started worker and the outcome of its start-up handshake. */
interface WorkerSlot {
  readonly worker: NodeWorker;
  readonly ready: Promise<Result<void>>;
}

/** The pool's idle worker: `none`, or one initialized worker waiting for the next job. */
type IdleWorker = { readonly kind: 'none' } | { readonly kind: 'ready'; readonly slot: WorkerSlot };

/** What happens to a job's worker when the job settles: kept for the next job, or terminated. */
type Settlement = 'reuse' | 'terminate';

/** A job's answer and what happens to its worker. */
interface JobEnd {
  readonly result: Result<unknown>;
  readonly settlement: Settlement;
}

/** The one idle worker, shared by every job of one pool. */
interface IdleCell {
  /** The idle worker, or `start()`'s new one when none is idle; the cell is empty afterwards. */
  readonly take: (start: () => WorkerSlot) => WorkerSlot;
  /** Keeps `slot` as the idle worker when none is idle; otherwise terminates it. */
  readonly release: (slot: WorkerSlot) => void;
  /** Empties the cell when `worker` is the idle one (it crashed or exited). */
  readonly retire: (worker: NodeWorker) => void;
}

/** What one job runs with. */
interface Pool {
  readonly idle: IdleCell;
  readonly start: () => WorkerSlot;
  readonly timeoutMs: number;
}

const NO_IDLE: IdleWorker = Object.freeze({ kind: 'none' });

/**
 * Starts the pool with one idle worker; `ready` answers once it has loaded, or `unavailable` at
 * `worker` when it fails, exits or exceeds `timeoutMs` during start-up. `entry` is the worker
 * realm's script; compose names it. `run` fails with `cancelled` at `worker` when the signal
 * aborts, and `unavailable` at `worker` when a worker cannot start, fails, exits, exceeds
 * `timeoutMs` or returns a malformed result.
 */
export function createRenderTransport(
  entry: URL,
  timeoutMs: number,
): RenderTransport & { readonly ready: Promise<Result<void>> } {
  const idle = createIdleCell();
  const start = (): WorkerSlot => startWorker(entry, timeoutMs, (worker) => idle.retire(worker));
  const first = start();
  idle.release(first);
  return {
    ready: first.ready,
    run: (job, signal) => runJob(job, signal, { idle, start, timeoutMs }),
  };
}

/** An empty idle cell. Never fails. */
function createIdleCell(): IdleCell {
  let idle = NO_IDLE;
  return {
    take: (start) => {
      const current = idle;
      idle = NO_IDLE;
      if (current.kind === 'ready') return current.slot;
      return start();
    },
    release: (slot) => {
      idle = keepIdle(idle, slot);
    },
    retire: (worker) => {
      idle = retired(idle, worker);
    },
  };
}

/** `slot` as the new idle worker when none is idle; otherwise `slot`'s worker is terminated. */
function keepIdle(
  idle: IdleWorker,
  slot: WorkerSlot,
): IdleWorker {
  if (idle.kind === 'ready') {
    void slot.worker.terminate();
    return idle;
  }
  slot.worker.unref();
  return { kind: 'ready', slot };
}

/** `none` when `worker` is the idle one; otherwise the idle worker unchanged. */
function retired(
  idle: IdleWorker,
  worker: NodeWorker,
): IdleWorker {
  if (idle.kind === 'ready' && idle.slot.worker === worker) return NO_IDLE;
  return idle;
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
 * Waits for the worker's `{ ready: true }` handshake; it loads code only and never computes a
 * diagram. Fails with `unavailable` at `worker` when the first message is anything else, or the
 * worker fails, exits or exceeds `timeoutMs` (the worker is then terminated).
 */
function initialized(
  worker: NodeWorker,
  timeoutMs: number,
): Promise<Result<void>> {
  return new Promise((resolve) => {
    function finish(result: Result<void>): void {
      clearTimeout(timer);
      worker.removeListener('message', ready);
      worker.removeListener('error', failed);
      worker.removeListener('exit', exited);
      resolve(result);
    }
    function ready(input: unknown): void {
      if (!isReady(input)) return finish(notReady('Invalid rendering worker initialization'));
      finish(success(undefined));
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
    worker.once('message', ready);
    worker.once('error', failed);
    worker.once('exit', exited);
  });
}

/** A failed handshake: `unavailable` at `worker`. */
function notReady(message: string): Result<void> {
  return failure('unavailable', 'worker', message);
}

/** True when `input` is the worker's `{ ready: true }` handshake. */
function isReady(input: unknown): boolean {
  return typeof input === 'object' && input !== null && 'ready' in input && input.ready === true;
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
    const slot = pool.idle.take(pool.start);
    const ready = await slot.ready;
    if (!ready.ok) return notStarted();
    return await observe(slot.worker, job, signal, pool.timeoutMs, () => pool.idle.release(slot));
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
 * Terminates a `terminate` worker first, or hands a `reuse` worker back to the pool at once.
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
async function terminated(
  worker: NodeWorker,
  result: Result<unknown>,
): Promise<Result<unknown>> {
  try {
    await worker.terminate();
    return result;
  } catch {
    return failure('unavailable', 'worker', 'Worker termination could not be confirmed');
  }
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
