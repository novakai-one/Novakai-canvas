import { Worker as NodeWorker } from 'node:worker_threads';
import type { RenderingJob } from '../../contract/records/rendering.js';
import type { RenderTransport } from '../../contract/ports/rendering.js';
import { resultEnvelope } from '../../contract/records/results.js';
import { failure, type Result } from '../../contract/errors.js';
/** Structured worker replies remain unknown until the composed reader independently reconstructs the scene. */
function reply(input: unknown): Result<unknown> {
  const parsed = resultEnvelope.safeParse(input);
  if (!parsed.success)
    return failure('unavailable', 'worker', 'Rendering worker returned a malformed result');
  return parsed.data;
}
/** Cancellation destroys the active realm; successful work can reuse its initialized modules and font providers. */
function observe(
  worker: NodeWorker,
  job: RenderingJob,
  signal: AbortSignal,
  timeoutMs: number,
  release: (worker: NodeWorker) => void,
): Promise<Result<unknown>> {
  return new Promise((resolve) => {
    let settled = false;
    function finish(
      result: Result<unknown>,
      reusable = false,
    ): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.removeListener('message', message);
      worker.removeListener('error', error);
      worker.removeListener('exit', exited);
      if (reusable) {
        release(worker);
        resolve(result);
        return;
      }
      void worker.terminate().then(
        () => resolve(result),
        () =>
          resolve(failure('unavailable', 'worker', 'Worker termination could not be confirmed')),
      );
    }
    function message(input: unknown): void {
      finish(reply(input), true);
    }
    function error(): void {
      finish(failure('unavailable', 'worker', 'Rendering worker failed'));
    }
    function exited(): void {
      finish(failure('unavailable', 'worker', 'Rendering worker ended without a result'));
    }
    function cancel(): void {
      finish(failure('cancelled', 'worker', 'Rendering was cancelled'));
    }
    const timer = setTimeout(
      () => finish(failure('unavailable', 'worker', 'Rendering exceeded its time limit')),
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
interface WorkerSlot {
  readonly worker: NodeWorker;
  readonly ready: Promise<void>;
}
/** Startup readiness precedes jobs; it loads code only and never computes a diagram. */
function initialized(
  worker: NodeWorker,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    function finish(error?: Error): void {
      clearTimeout(timer);
      worker.removeListener('message', ready);
      worker.removeListener('error', failed);
      worker.removeListener('exit', exited);
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    }
    function ready(input: unknown): void {
      if (
        typeof input !== 'object' ||
        input === null ||
        !('ready' in input) ||
        input.ready !== true
      )
        return finish(new Error('Invalid rendering worker initialization'));
      finish();
    }
    function failed(): void {
      finish(new Error('Rendering worker initialization failed'));
    }
    function exited(): void {
      finish(new Error('Rendering worker exited during initialization'));
    }
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(new Error('Rendering worker initialization timed out'));
    }, timeoutMs);
    worker.once('message', ready);
    worker.once('error', failed);
    worker.once('exit', exited);
  });
}
/** Keep one idle initialized worker, never derived geometry. Concurrent jobs retain separate cancellation realms. */
export function createRenderTransport(
  timeoutMs: number,
): RenderTransport & { readonly ready: Promise<void> } {
  let idle: WorkerSlot | null = null;
  function create(): WorkerSlot {
    const worker = new NodeWorker(new URL('../../cli/render-worker.mjs', import.meta.url), {
      execArgv: [],
    });
    const retired = (): void => {
      if (idle?.worker === worker) idle = null;
    };
    worker.on('error', retired);
    worker.on('exit', retired);
    worker.unref();
    return { worker, ready: initialized(worker, timeoutMs) };
  }
  function release(slot: WorkerSlot): void {
    if (idle !== null) {
      void slot.worker.terminate();
      return;
    }
    idle = slot;
    slot.worker.unref();
  }
  idle = create();
  return {
    ready: idle.ready,
    async run(job, signal): Promise<Result<unknown>> {
      try {
        const slot = idle ?? create();
        idle = null;
        await slot.ready;
        return await observe(slot.worker, job, signal, timeoutMs, () => release(slot));
      } catch {
        return failure('unavailable', 'worker', 'Rendering worker could not start');
      }
    },
  };
}
