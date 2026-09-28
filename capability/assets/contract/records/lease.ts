import { z } from 'zod';
import { digest, leaseId } from '../brands.js';

/**
 * Checks a stored lease: its `id`, the `ownerPid` of the process that holds it (a positive safe
 * integer) and the `digests` it protects. No other fields. A lease has no expiry time; it ends
 * only when released, or when collection finds its owner process is gone.
 */
export const leaseRecord = z
  .strictObject({
    id: leaseId,
    ownerPid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).brand<'ProcessId'>(),
    digests: z.array(digest).readonly(),
  })
  .readonly();

/** Checks a list of digests, for example the digests to lease or the reachable digests. */
export const digestList = z.array(digest).readonly();

/** A lease that passed {@link leaseRecord}. */
export type LeaseRecord = z.infer<typeof leaseRecord>;
