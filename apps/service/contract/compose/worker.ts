/*
 * Render worker lifecycle and the diagram producer. The explicit worker keeps native measurement
 * away from browser imports; the parent owns worker failure and retry. Real worker execution and
 * independent owner readout are bound once; the service retains the prior scene on any failed job.
 */
import { prepareLayoutRuntime } from '@novakai/canvas-layout';
import { prepareNativePresentation } from '@novakai/canvas-presentation';
import type { DiagramProducer } from '../ports/rendering.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import { produce } from '../../core/rendering/produce.js';

/** Explicit worker lifecycle keeps native measurement away from browser imports; the parent owns worker failure/retry. */
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

/** Native measurement and layout runtime prepare together; the first owner failure is reported. */
async function prepareNativeRuntimes(): Promise<Result<void>> {
  const prepared = await Promise.all([prepareNativePresentation(), prepareLayoutRuntime()]);
  const failed = prepared.find((result) => !result.ok);
  if (failed && !failed.ok) {
    return failure('unavailable', 'worker', failed.error.message, failed.error);
  }
  return { ok: true, value: undefined };
}

/** Bind real worker execution and independent owner readout once; service retains the prior scene on any failed job. */
export async function createDiagramProducer(timeoutMs: number): Promise<Result<DiagramProducer>> {
  try {
    const [worker, output] = await Promise.all([
      import('../../adapters/render-worker/pool.js'),
      import('../../adapters/render-worker/reply-reader.js'),
    ]);
    const transport = worker.createRenderTransport(timeoutMs);
    await transport.ready;
    return {
      ok: true,
      value: {
        produce: (job, signal) =>
          produce(job, signal, transport, { read: output.readRenderDocument }),
      },
    };
  } catch {
    return failure('unavailable', 'render', 'Rendering bindings could not initialize');
  }
}
