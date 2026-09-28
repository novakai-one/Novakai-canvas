import { describe, it, expect, vi } from 'vitest';
import type { Result } from '../contract/index.js';
import { request, value, rejects, abcDigest } from './fixtures.js';
import { harness, faultStore } from './storage-harness.js';
import { resources, failure } from './resource-harness.js';

// Backup copies a state and its asset bytes; restore installs a bundle into an empty location.
describe('Persistence backup and restore', () => {
  /**
   * Backup leases exactly the assets the state references, returns their verified bytes and
   * releases the lease. Bytes that do not match their digest are `corrupt-record`, and the lease
   * is still released.
   */
  it('backs up exactly the referenced assets under a verified lease that is always released', async () => {
    const source = harness('memory');
    // One record references the asset `abc`.
    value(
      source.persistence.commit({
        ...request(),
        writes: [
          {
            ...request().writes[0],
            kind: 'put',
            key: request().expected[0]?.key,
            value: { title: 'Media' },
            resources: [abcDigest],
          },
        ],
      }),
    );

    // Backup: leases [abc], returns its bytes, releases the lease once.
    const provider = resources();
    const bundle = value(await source.persistence.backup(provider));
    expect(provider.acquire).toHaveBeenCalledWith([abcDigest]);
    expect(bundle.blobs).toEqual([{ digest: abcDigest, base64: 'YWJj' }]);
    expect(provider.release).toHaveBeenCalledTimes(1);

    // The provider returns other bytes (`bad`): corrupt, and the lease is released again.
    provider.read.mockResolvedValueOnce({ ok: true, value: 'YmFk' });
    rejects(await source.persistence.backup(provider), 'corrupt-record');
    expect(provider.release).toHaveBeenCalledTimes(2);
    value(source.persistence.close());
    source.remove();
  });

  /**
   * Restore checks asset coverage before domain validation, and domain validation before any
   * asset is reserved. A valid bundle installs the exact state; a second restore into the now-used
   * location is `destination-not-empty`.
   */
  it('checks asset coverage and domain validity before installing into an empty destination', async () => {
    const source = harness('memory');
    const destination = harness('file');
    value(source.persistence.commit(request()));
    const provider = resources();
    const bundle = value(await source.persistence.backup(provider));
    const domain = vi.fn(async (): Promise<Result<void>> => ({ ok: true, value: undefined }));

    // A blob the state does not reference: corrupt, before domain validation runs.
    rejects(
      await destination.persistence.restore(
        { ...bundle, blobs: [{ digest: abcDigest, base64: 'YWJj' }] },
        provider,
        domain,
      ),
      'corrupt-record',
    );
    expect(domain).not.toHaveBeenCalled();

    // Domain validation fails: corrupt, before any asset is reserved.
    const rejectDomain = vi.fn(async (): Promise<Result<void>> => failure('corrupt-record'));
    rejects(
      await destination.persistence.restore(bundle, provider, rejectDomain),
      'corrupt-record',
    );
    expect(provider.reserve).not.toHaveBeenCalled();

    // A valid bundle installs the exact backed-up state.
    value(await destination.persistence.restore(bundle, provider, domain));
    expect(domain).toHaveBeenCalledWith(bundle.state);
    expect(value(destination.persistence.readSnapshot())).toEqual(bundle.state);

    // The destination is no longer empty.
    rejects(
      await destination.persistence.restore(bundle, provider, domain),
      'destination-not-empty',
    );
    value(source.persistence.close());
    value(destination.persistence.close());
    source.remove();
    destination.remove();
  });

  /**
   * A staging failure leaves the destination's documents unchanged, and a restore does not overwrite
   * a commit that races it.
   * A provider that throws during backup is `storage-unavailable`. A lost COMMIT acknowledgement is
   * `storage-unavailable` although the state was installed. Every acquired lease is released.
   */
  it('keeps the destination on a staging failure, never overwrites a racing commit, and releases leases', async () => {
    const source = harness('memory');
    const destination = harness('memory');
    value(
      source.persistence.commit({
        ...request(),
        writes: [
          { kind: 'put', key: request().expected[0]?.key, value: {}, resources: [abcDigest] },
        ],
      }),
    );
    const provider = resources();
    const bundle = value(await source.persistence.backup(provider));

    // Staging fails: nothing installed; the backup and restore leases are both released.
    provider.stage.mockResolvedValueOnce(failure('storage-unavailable'));
    const domain = async (): Promise<Result<void>> => ({ ok: true, value: undefined });
    rejects(await destination.persistence.restore(bundle, provider, domain), 'storage-unavailable');
    expect(value(destination.persistence.readSnapshot()).sequence).toBe(0);
    expect(provider.release).toHaveBeenCalledTimes(2);

    // Another commit lands while staging: the restore stops and the racing commit is kept.
    provider.stage.mockImplementationOnce(async () => {
      value(destination.persistence.commit(request('race')));
      return { ok: true, value: undefined };
    });
    rejects(
      await destination.persistence.restore(bundle, provider, domain),
      'destination-not-empty',
    );
    expect(value(destination.persistence.receipt('race'))).not.toBeNull();

    // The provider throws during backup: storage-unavailable, and the lease is released.
    provider.read.mockRejectedValueOnce(new Error('Provider failed'));
    rejects(await source.persistence.backup(provider), 'storage-unavailable');
    expect(provider.release).toHaveBeenCalledTimes(4);

    // COMMIT succeeds but its acknowledgement is lost: uncertain, yet the state is installed.
    const uncertain = faultStore('after-commit');
    rejects(await uncertain.persistence.restore(bundle, provider, domain), 'storage-unavailable');
    expect(uncertain.inspect()).toEqual(bundle.state);
    expect(provider.release).toHaveBeenCalledTimes(5);
    uncertain.close();
    value(source.persistence.close());
    value(destination.persistence.close());
    source.remove();
    destination.remove();
  });
});
