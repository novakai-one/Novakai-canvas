import { describe, it, expect } from 'vitest';
import { createAssets } from '../contract/index.js';
import { harness } from './harness.js';
import { submission, value, rejects, missing, delayedMedia, noReferences } from './fixtures.js';

/** Leases: acquiring, reserving, releasing and collection around them. */
describe('leases', () => {
  /**
   * Acquiring a stored digest with a missing one fails as a whole (`missing-asset`) and records
   * no lease, so collection removes the stored blob. A lease on a duplicated digest reads it and
   * keeps it from collection. Releasing twice succeeds; reading afterwards is `lease-expired`.
   */
  it('acquires all requested bytes atomically and releases idempotently', async () => {
    const { assets } = harness();
    const id = value(await assets.stage(submission())).descriptor.digest;
    // All-or-nothing acquire.
    rejects(assets.acquire([id, missing]), 'missing-asset');
    expect(value(assets.collectUnreferenced(noReferences)).removed).toEqual([id]);
    // Lease protects the restaged blob.
    value(await assets.stage(submission()));
    const lease = value(assets.acquire([id, id]));
    expect(value(lease.read(id)).descriptor.digest).toBe(id);
    expect(value(assets.collectUnreferenced(noReferences)).retained).toEqual([id]);
    // Idempotent release.
    value(lease.release());
    value(lease.release());
    rejects(lease.read(id), 'lease-expired');
  });

  /**
   * A reservation installs backup bytes only for the right digest (`corrupt-asset` for another
   * one), then protects them from collection. When the lease is released while staging waits in
   * the media processor, staging ends `lease-expired`.
   */
  it('stages exact reserved bytes and rejects membership released during async validation', async () => {
    // Arrange: bytes from another store.
    const source = harness();
    const destination = harness();
    const id = value(await source.assets.stage(submission())).descriptor.digest;
    const bytes = value(source.assets.resolve(id)).base64;
    // Reserved staging.
    const lease = value(destination.assets.reserve([id]));
    rejects(await lease.stage(missing, bytes), 'corrupt-asset');
    value(await lease.stage(id, bytes));
    expect(value(destination.assets.resolve(id)).base64).toBe(bytes);
    expect(value(destination.assets.collectUnreferenced(noReferences)).retained).toEqual([id]);
    value(lease.release());
    // Release while staging waits in the processor.
    const pause = Promise.resolve();
    const delayed = createAssets({
      ...destination.deps,
      media: delayedMedia(destination.deps.media, pause),
    });
    const pendingLease = value(delayed.reserve([id]));
    const pending = pendingLease.stage(id, bytes);
    value(pendingLease.release());
    rejects(await pending, 'lease-expired');
  });

  /**
   * Collection keeps referenced bytes and removes unreferenced ones. A reservation can then
   * restore them (acquire fails until then); an acquired lease keeps them after the reservation
   * is released. When every lease owner is reported dead, their leases are deleted and the bytes
   * collected.
   */
  it('collects only unreferenced unleased bytes and handles stage-GC-reserve safely', async () => {
    const fixture = harness();
    const { assets } = fixture;
    const id = value(await assets.stage(submission())).descriptor.digest;
    const bytes = value(assets.resolve(id)).base64;
    // Referenced, then unreferenced.
    // The reader reports `id` as referenced.
    expect(value(assets.collectUnreferenced(() => ({ ok: true, value: [id] }))).retained).toEqual([
      id,
    ]);
    expect(value(assets.collectUnreferenced(noReferences)).removed).toEqual([id]);
    // Restore under a reservation.
    const reservation = value(assets.reserve([id]));
    rejects(assets.acquire([id]), 'missing-asset');
    value(await reservation.stage(id, bytes));
    const admitted = value(assets.acquire([id]));
    value(reservation.release());
    expect(value(assets.collectUnreferenced(noReferences)).retained).toEqual([id]);
    // Dead owners' leases are recovered.
    const deadOwners = createAssets({
      ...fixture.deps,
      // Every lease owner is reported dead.
      identity: { ...fixture.deps.identity, ownerAlive: () => false },
    });
    expect(value(deadOwners.collectUnreferenced(noReferences)).removed).toEqual([id]);
    rejects(admitted.read(id), 'lease-expired');
  });
});
