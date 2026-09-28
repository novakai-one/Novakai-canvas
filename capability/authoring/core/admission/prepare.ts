import type { Digest } from '../../contract/brands.js';
import type { ReceiptReader } from '../../contract/ports/store.js';
import type { Request } from '../../contract/records/request.js';
import type { Receipt } from '../../contract/records/storage.js';
import type { PreparedCandidate } from '../../contract/records/proposal.js';
import type { AdmissionDependencies } from '../../contract/types.js';
import { fingerprint } from '../identity/canonical.js';
import { reconcile } from '../identity/receipts.js';
import { readSnapshot } from '../validation/snapshot.js';
import { accepted } from '../validation/outcomes.js';
import { checkRequest } from './dependencies.js';
import { buildCandidate, checkCancellation } from './pipeline.js';
import { releaseProtection } from './resources.js';

/**
 * Admits a request and passes the prepared candidate to `continueWith`, unless the request already committed.
 *
 * Steps:
 * 1. Compute the request fingerprint and look up a stored receipt. If the request already
 *    committed, return that receipt.
 * 2. Otherwise check for cancellation, read the snapshot, check the request, take a resource
 *    lease and build the candidate.
 * 3. Run `continueWith` (preview or commit) while the lease is held, then release it.
 *
 * If step 2 or 3 fails, the receipt store is checked once more: an identical request may have
 * committed in the meantime, and its receipt wins over the failure. Step 1 failures are not reconciled.
 *
 * @param request - The checked submitted request.
 * @param preview - `true` to ask the feasibility check for a preview.
 * @param deps - The admission collaborators.
 * @param continueWith - What to do with the prepared candidate, for example commit it.
 * @returns The result of `continueWith`, or the stored receipt when the request already committed.
 * @throws AuthoringFault from fingerprinting or the first receipt lookup.
 * @throws The admission or `continueWith` failure, rethrown unchanged, when no receipt exists afterwards.
 */
export async function withCandidate<T>(
  request: Request,
  preview: boolean,
  deps: AdmissionDependencies,
  continueWith: (candidate: PreparedCandidate) => Promise<T>,
): Promise<T | Receipt> {
  const identity = fingerprint(request, deps.hash);
  const storedReceipt = await reconcile(request, identity, deps.receipts);
  if (storedReceipt !== null) return storedReceipt;

  try {
    return await prepareUncommitted(request, identity, preview, deps, continueWith);
  } catch (error) {
    return reconcileRejected(request, identity, deps.receipts, error);
  }
}

/**
 * Checks for a receipt after a failed attempt. Returns it when one now exists, otherwise rethrows the failure.
 * Receipts and snapshots are not assumed to be read atomically, so a late receipt replaces an out-of-date failure.
 */
async function reconcileRejected(
  request: Request,
  identity: Digest,
  receipts: ReceiptReader,
  error: unknown,
): Promise<Receipt> {
  const lateReceipt = await reconcile(request, identity, receipts);
  if (lateReceipt !== null) return lateReceipt;
  throw error;
}

/** Reads and checks the snapshot, holds a resource lease, and runs `continueWith` on the built candidate. */
async function prepareUncommitted<T>(
  request: Request,
  identity: Digest,
  preview: boolean,
  deps: Omit<AdmissionDependencies, 'receipts'>,
  continueWith: (candidate: PreparedCandidate) => Promise<T>,
): Promise<T> {
  checkCancellation(request, deps.cancellation);
  const storedSnapshot = accepted(await deps.snapshots.read(request.workspace));
  const before = readSnapshot(storedSnapshot, request.workspace);
  checkRequest(request, before);

  const lease = accepted(await deps.resources.acquire(request, before));
  // The lease is held until `continueWith` finishes, so a commit never loses protected bytes.
  try {
    const candidate = await buildCandidate(request, identity, before, lease, preview, deps);
    return await continueWith(candidate);
  } finally {
    await releaseProtection(lease);
  }
}
