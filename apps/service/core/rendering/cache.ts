/*
 * Why this file exists
 *
 * Saving a change usually draws the same diagram twice. For example, saving a change to
 * `my-diagram` draws it once to check it can be laid out, then the browser asks to see it.
 * Laying a diagram out is slow, and the second drawing would come out the same.
 *
 * This file remembers the last 8 drawings that worked and answers a repeat from memory. A job is a
 * repeat when everything but its ID matches. A failure is never remembered, so a retry always
 * draws again. It keeps nothing on disk.
 */
import type { DiagramProducer } from '../../contract/ports/rendering.js';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';

/** Recent renders kept; enough for the check render during apply plus the reads after it. */
const KEEP = 8;

/**
 * Wraps `producer` so it answers a repeated render job from memory.
 * A job that matches one of the last 8 that worked gets that same answer. Any other job goes to
 * `producer`, and its mistakes pass through unchanged.
 */
export function cacheRenders(producer: DiagramProducer): DiagramProducer {
  const kept = new Map<string, Result<RenderDocument>>();
  return {
    async produce(job, signal) {
      const key = inputKey(job);
      const known = kept.get(key);
      if (known !== undefined) return known;
      return remember(kept, key, await producer.produce(job, signal));
    },
  };
}

/** Everything that shapes the output except the job id. */
function inputKey(job: RenderingJob): string {
  return JSON.stringify([
    job.collection,
    job.style,
    job.options,
    job.fonts.map((font) => font.digest),
    job.assets.map((asset) => asset.digest),
    job.wasmResource,
  ]);
}

/** Only successful renders are kept; the oldest entry is evicted past KEEP. */
function remember(
  kept: Map<string, Result<RenderDocument>>,
  key: string,
  result: Result<RenderDocument>,
): Result<RenderDocument> {
  if (!result.ok) return result;
  kept.set(key, result);
  evictOldest(kept);
  return result;
}

/** Bounded memory: the oldest render is evicted once past KEEP. */
function evictOldest(kept: Map<string, Result<RenderDocument>>): void {
  if (kept.size <= KEEP) return;
  const oldest = kept.keys().next();
  if (oldest.done !== true) kept.delete(oldest.value);
}
