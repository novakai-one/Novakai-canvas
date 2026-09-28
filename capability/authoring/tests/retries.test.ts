import { describe, it, expect, vi, assert } from 'vitest';
import {
  createAuthoring,
  failure,
  type Result,
  type Receipt,
  type CommitRequest,
} from '../contract/index.js';
import {
  harness,
  seed,
  value,
  rejects,
  request,
  diagram,
  put,
  key,
  record,
  workspace,
  media,
  alternate,
} from './fixtures.js';
import { race, gate } from './gates.js';

describe('Authoring retry identity', () => {
  /**
   * A retry of a committed request returns the original receipt without acquiring resources
   * again, so it succeeds even after the original asset is gone. The same request ID with a
   * different envelope is rejected.
   */
  it('returns the original receipt on retry without re-resolving assets, and rejects a reused ID with a changed request', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'retry', [
      put('collection', 'demo', diagram('demo', 'Changed'), [media]),
    ]);
    const acquire = vi.fn(h.deps.resources.acquire);
    const api = createAuthoring({ ...h.deps, resources: { acquire } });
    const first = value(await api.apply(edit));

    // The asset is now missing, but the retry never asks for it.
    acquire.mockResolvedValue(failure('missing-asset', 'digest', 'Original source removed'));
    const second = value(await api.apply(edit));
    expect(second).toEqual(first);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(first.outcome.pins).toEqual({ theme: 'paper@1' });

    // Same ID, different submitted assets.
    rejects(
      await api.apply({ ...edit, assets: [{ alias: 'changed-file', digest: alternate }] }),
      'request-reused',
    );
    expect(value(await api.receipt(workspace, 'retry'))).toEqual(first);
    h.store.close();
  });

  /**
   * Two copies of one request racing commit once and both get the same receipt. Two different
   * requests with the same ID: one commits, the other is rejected. Edits to different collections
   * both commit. A copy of a request held at its snapshot read while the same request commits gets
   * that commit's receipt.
   */
  it('commits simultaneous retries once, rejects a racing reused ID, commits unrelated edits, and answers a late retry with the receipt', async () => {
    const h = harness();
    await seed(h, ['demo', 'other']);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'race', [
      put('collection', 'demo', diagram('demo', 'Winner'), [media]),
    ]);

    // The same request twice: one effect, identical receipts.
    const identical = await race(h.deps, edit, edit);
    const [firstResult, secondResult] = identical;
    assert(firstResult && secondResult, 'race returns two results');
    expect(value(firstResult)).toEqual(value(secondResult));
    expect(record(value(await h.api.read(workspace)), key('collection', 'demo')).version).toBe(1);

    // Two different requests under one ID: exactly one wins.
    const second = value(await h.api.read(workspace));
    const left = request(second, 'reused', [
      put('collection', 'demo', diagram('demo', 'Left'), [media]),
    ]);
    const right = request(second, 'reused', [
      put('collection', 'demo', diagram('demo', 'Right'), [media]),
    ]);
    const competing = await race(h.deps, left, right);
    expect(competing.filter((result) => result.ok)).toHaveLength(1);
    expect(competing.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code: 'request-reused' }) }),
    ]);

    // Edits to two different collections both commit; the catalog is untouched.
    const current = value(await h.api.read(workspace));
    const independent = await race(
      h.deps,
      request(current, 'one', [put('collection', 'demo', diagram('demo', 'One'), [media])]),
      request(current, 'two', [put('collection', 'other', diagram('other', 'Two'), [media])]),
    );
    expect(independent.every((result) => result.ok)).toBe(true);
    expect(record(value(await h.api.read(workspace)), key('catalog', 'catalog')).version).toBe(0);

    // Hold one copy at its snapshot read, commit another copy, then release: same receipt.
    const lateSnapshot = value(await h.api.read(workspace));
    const lateRequest = request(lateSnapshot, 'late-retry', [
      put('collection', 'demo', diagram('demo', 'Late retry'), [media]),
    ]);
    const entered = gate();
    const resume = gate();
    const delayed = createAuthoring({
      ...h.deps,
      snapshots: {
        read: async (workspace) => {
          entered.open();
          await resume.promise;
          return h.deps.snapshots.read(workspace);
        },
      },
    });
    const late = delayed.apply(lateRequest);
    await entered.promise;
    const winner = value(await h.api.apply(lateRequest));
    resume.open();
    expect(value(await late)).toEqual(winner);

    h.store.close();
  });

  /**
   * When the commit succeeds but its acknowledgement is lost, the stored receipt is found and
   * returned. When storage fails before the transaction, nothing is stored and the request can
   * be retried.
   */
  it('recovers the receipt when a commit acknowledgement is lost, and allows a retry after a failure before commit', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'uncertain', [
      put('collection', 'demo', diagram('demo', 'Saved'), [media]),
    ]);

    // The commit happens, then the store reports a failure.
    const commits = {
      commit: vi.fn(async (commit: CommitRequest): Promise<Result<Receipt>> => {
        value(await h.deps.commits.commit(commit));
        return failure('storage-unavailable', 'ack', 'Acknowledgement lost');
      }),
    };
    const api = createAuthoring({ ...h.deps, commits });
    const recovered = value(await api.apply(edit));
    expect(recovered.outcome.status).toBe('committed');
    expect(record(value(await api.read(workspace)), key('collection', 'demo')).version).toBe(1);

    // The first commit fails without writing; the retry commits.
    const next = request(value(await api.read(workspace)), 'retryable', [
      put('collection', 'demo', diagram('demo', 'Next'), [media]),
    ]);
    const failCommit = vi
      .fn(h.deps.commits.commit)
      .mockResolvedValueOnce(
        failure('storage-unavailable', 'commit', 'Unavailable before transaction'),
      );
    const retry = createAuthoring({ ...h.deps, commits: { commit: failCommit } });
    rejects(await retry.apply(next), 'storage-unavailable');
    expect(value(await retry.receipt(workspace, 'retryable'))).toBeNull();
    value(await retry.apply(next));
    expect(record(value(await retry.read(workspace)), key('collection', 'demo')).version).toBe(2);
    h.store.close();
  });
});
