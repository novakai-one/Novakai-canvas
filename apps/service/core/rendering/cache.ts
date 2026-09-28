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

/** The most drawings kept; enough for the check drawing while saving plus the reads after it. */
const MOST_KEPT = 8;

/**
 * The drawings that worked, each under its job's key (see `jobKey`), oldest first. Only successes
 * are ever kept.
 */
type KeptDrawings = Map<string, Result<RenderDocument>>;

/**
 * Wraps `producer` so it answers a repeated render job from memory.
 * A job that matches one of the last 8 that worked gets that same answer. Any other job goes to
 * `producer`, and its mistakes pass through unchanged.
 */
export function cacheRenders(producer: DiagramProducer): DiagramProducer {
  const kept: KeptDrawings = new Map();
  return {
    produce: (job, signal) => recallOrProduce(job, signal, producer, kept),
  };
}

/** Answers a repeated job with its kept drawing, or draws the job and keeps it if it worked. */
async function recallOrProduce(
  job: RenderingJob,
  signal: AbortSignal,
  producer: DiagramProducer,
  kept: KeptDrawings,
): Promise<Result<RenderDocument>> {
  const key = jobKey(job);
  const known = kept.get(key);
  if (known !== undefined) {
    return known;
  }
  const produced = await producer.produce(job, signal);
  return remember(kept, key, produced);
}

/** Writes everything that shapes the drawing, except the job's ID, as one text key. */
function jobKey(job: RenderingJob): string {
  return JSON.stringify([
    job.collection,
    job.style,
    job.options,
    job.fonts.map((font) => font.digest),
    job.assets.map((asset) => asset.digest),
    job.wasmResource,
  ]);
}

/** Keeps a drawing that worked, then hands back the producer's answer unchanged. */
function remember(
  kept: KeptDrawings,
  key: string,
  produced: Result<RenderDocument>,
): Result<RenderDocument> {
  if (!produced.ok) {
    return produced;
  }
  kept.set(key, produced);
  forgetOldestPastLimit(kept);
  return produced;
}

/** Forgets the oldest drawing once more than `MOST_KEPT` are kept. */
function forgetOldestPastLimit(kept: KeptDrawings): void {
  if (kept.size <= MOST_KEPT) {
    return;
  }
  forgetOldest(kept);
}

/** Forgets the drawing kept longest ago; a Map lists its keys in the order they were added. */
function forgetOldest(kept: KeptDrawings): void {
  const [oldestKey] = kept.keys();
  if (oldestKey === undefined) {
    return;
  }
  kept.delete(oldestKey);
}
