/*
 * Names a render job after why it runs. The one place a RenderJobId is minted. Pure. The ID only
 * labels the job (Layout reports a cancelled job at it); the render cache ignores it, and callers
 * own retry.
 */
import type { Collection } from '../../contract/records/capabilities.js';
import type { RenderPurpose } from '../../contract/records/rendering/job.js';
import { renderJobId, type RenderJobId } from '../../contract/brands.js';

/** The collection fields a job ID is built from. */
type JobSubject = Pick<Collection, 'id' | 'revision'>;

/**
 * The job ID for one purpose: `read:<collection>:<revision>`, `admission:<collection>:<revision>`
 * or `headless`. Throws zod's error only when the ID passes 256 characters. That cannot happen for
 * a stored or candidate collection: its ID is also its Authoring record ID (at most 128
 * characters). core/rendering/jobs.ts calls it inside its catch.
 */
export function jobId(
  purpose: RenderPurpose,
  collection: JobSubject,
): RenderJobId {
  return renderJobId.parse(JOB_TEXT[purpose](collection));
}

/** The ID text for each purpose. Every purpose has a row (checked by the type). */
const JOB_TEXT: Readonly<Record<RenderPurpose, (collection: JobSubject) => string>> = Object.freeze(
  {
    read: (collection) => `read:${collection.id}:${collection.revision}`,
    admission: (collection) => `admission:${collection.id}:${collection.revision}`,
    headless: () => 'headless',
  },
);
