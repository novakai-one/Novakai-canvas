/*
 * Why this file exists
 *
 * Every render job needs an ID, so Layout can say which job it stopped when a newer one replaces
 * it. The ID says why the job runs and what it draws. For example, reading `my-diagram` at
 * revision 3 is the job `read:my-diagram:3`.
 *
 * This file is the one place a render job ID (`RenderJobId`, contract/brands.ts) is made. The ID
 * is only a label: the render cache ignores it. It reads nothing.
 */
import type { AuthoringResult, Collection } from '../../contract/records/capability-types.js';
import type { RenderPurpose } from '../../contract/records/rendering/job.js';
import { renderJobId, type RenderJobId } from '../../contract/brands.js';
import { success } from '../../contract/errors.js';
import { malformedResourceFailure } from './job-refusal.js';

/** Just the collection's ID and revision; a job ID is built from these. */
type CollectionAtRevision = Pick<Collection, 'id' | 'revision'>;

/**
 * Makes the ID of a render job from why it runs and the collection it draws.
 * For example `read:my-diagram:3`, `change-check:my-diagram:3`, or just `headless`.
 * Mistake: `invalid-input` at `render-resources` for an ID over 256 characters. A saved
 * collection can't reach that: its ID is at most 128 characters.
 */
export function buildRenderJobId(
  purpose: RenderPurpose,
  collection: CollectionAtRevision,
): AuthoringResult<RenderJobId> {
  const id = renderJobId.safeParse(JOB_TEXT[purpose](collection));
  if (!id.success) return malformedResourceFailure();
  return success(id.data);
}

/** The ID text for each purpose. Every purpose has a row (checked by the type). */
const JOB_TEXT: Readonly<Record<RenderPurpose, (collection: CollectionAtRevision) => string>> =
  Object.freeze({
    read: (collection) => `read:${collection.id}:${collection.revision}`,
    'change-check': (collection) => `change-check:${collection.id}:${collection.revision}`,
    headless: () => 'headless',
  });
