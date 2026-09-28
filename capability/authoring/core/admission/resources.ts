import type { ResourceLease } from '../../contract/ports/resources.js';
import type { Snapshot, Write } from '../../contract/records/storage.js';
import type { Digest } from '../../contract/brands.js';
import { findRecord } from '../records/keys.js';
import { reject } from '../validation/outcomes.js';

/**
 * Checks that the held resource lease protects every resource the writes depend on.
 *
 * For each write this includes the record's current resources, because history keeps them
 * for undo, and for a put also the new resources. Bytes must stay protected until the
 * storage transaction has settled.
 *
 * @param snapshot - The workspace snapshot before the writes.
 * @param writes - The writes about to be committed.
 * @param covered - The resource digests the lease protects.
 * @throws AuthoringFault `missing-asset` at the first resource the lease does not protect.
 */
export function checkCoverage(
  snapshot: Snapshot,
  writes: readonly Write[],
  covered: readonly Digest[],
): void {
  const needed = writes.flatMap((write) => resourcesUsedByWrite(snapshot, write));
  const missing = needed.find((resource) => !covered.includes(resource));
  if (missing !== undefined)
    reject('missing-asset', missing, 'A candidate/history resource is outside the held lease');
}

/**
 * Releases a resource lease without ever failing.
 *
 * A failed release, reported or thrown, is ignored: the lease stays held and Assets
 * maintenance recovers it later. A committed receipt is still the final outcome.
 *
 * @param lease - The lease to release.
 */
export async function releaseProtection(lease: ResourceLease): Promise<void> {
  try {
    await lease.release();
  } catch {
    // Ignored on purpose; see above.
    return;
  }
}

/**
 * Lists the resources one write depends on: the record's current resources, plus a put's new ones.
 * A delete keeps the old resources because history still needs them for undo.
 */
function resourcesUsedByWrite(
  snapshot: Snapshot,
  write: Write,
): readonly Digest[] {
  const previous = findRecord(snapshot, write.key);
  const currentResources = previous === null ? [] : previous.resources;
  if (write.kind === 'delete') return currentResources;
  return [...currentResources, ...write.resources];
}
