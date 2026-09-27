/*
 * Remembers the last few successful renders, keyed by everything that shapes the output except
 * the job id. The apply check renders the candidate, and the read right after the commit asks for
 * the same render, which is then answered from memory. In-memory state only; no I/O. Failures are
 * never kept, so a retry always reaches the producer.
 */
import type { DiagramProducer } from '../../contract/ports/rendering.js';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';

/** Recent renders kept; enough for the check render during apply plus the reads after it. */
const KEEP = 8;

/**
 * Wraps the producer with a cache of the last `KEEP` successful renders. A job with the same
 * input as a kept render gets the kept result; any other job, and any job with a previous scene,
 * goes to the producer. Failures pass through unchanged and are not kept.
 */
export function cacheRenders(producer: DiagramProducer): DiagramProducer {
  const kept = new Map<string, Result<RenderDocument>>();
  return {
    async produce(job, signal) {
      const key = inputKey(job);
      const known = key === null ? undefined : kept.get(key);
      if (known !== undefined) return known;
      return remember(kept, key, await producer.produce(job, signal));
    },
  };
}

/** Everything that shapes the output except the job id. Jobs with a previous scene are never cached. */
function inputKey(job: RenderingJob): string | null {
  if (job.previous !== null) return null;
  return JSON.stringify([
    job.collection,
    job.style,
    job.options,
    job.fonts.map((font) => font.digest),
    job.assets.map((asset) => asset.digest),
    job.wasmResource,
  ]);
}

/** Only successful, cacheable renders are kept; the oldest entry is evicted past KEEP. */
function remember(
  kept: Map<string, Result<RenderDocument>>,
  key: string | null,
  result: Result<RenderDocument>,
): Result<RenderDocument> {
  if (key === null || !result.ok) return result;
  kept.set(key, result);
  evictOldest(kept);
  return result;
}

/** Bounded memory: the oldest render is evicted once past KEEP. */
function evictOldest(kept: Map<string, Result<RenderDocument>>): void {
  if (kept.size > KEEP) kept.delete(kept.keys().next().value as string);
}
