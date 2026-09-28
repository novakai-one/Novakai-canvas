/*
 * Names a render job after why it runs. The one place a RenderJobId is minted. Pure. The ID only
 * labels the job (Layout reports a cancelled job at it); the render cache ignores it, and callers
 * own retry.
 */
import type { AuthoringResult, Collection } from '../../contract/records/capability-types.js';
import type { RenderPurpose } from '../../contract/records/rendering/job.js';
import { renderJobId, type RenderJobId } from '../../contract/brands.js';
import { success } from '../../contract/errors.js';
import { undecodable } from './job-refusal.js';

/** The collection fields a job ID is built from. */
type JobSubject = Pick<Collection, 'id' | 'revision'>;

/**
 * The job ID for one purpose: `read:<collection>:<revision>`,
 * `change-check:<collection>:<revision>` or `headless`. Fails with `invalid-input` at
 * `render-resources` only when the ID passes 256 characters. That cannot happen for a stored or
 * candidate collection: its ID is also its Authoring record ID (at most 128 characters).
 */
export function jobId(
  purpose: RenderPurpose,
  collection: JobSubject,
): AuthoringResult<RenderJobId> {
  const id = renderJobId.safeParse(JOB_TEXT[purpose](collection));
  if (!id.success) return undecodable();
  return success(id.data);
}

/** The ID text for each purpose. Every purpose has a row (checked by the type). */
const JOB_TEXT: Readonly<Record<RenderPurpose, (collection: JobSubject) => string>> = Object.freeze(
  {
    read: (collection) => `read:${collection.id}:${collection.revision}`,
    'change-check': (collection) => `change-check:${collection.id}:${collection.revision}`,
    headless: () => 'headless',
  },
);
