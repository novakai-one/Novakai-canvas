import { describe, it, expect } from 'vitest';
import { openSqlite, digest } from '../contract/index.js';
import type { CommitRequest } from '../contract/index.js';
import { request, value, rejects, collection, history, workspace, pristine } from './fixtures.js';
import { harness, faultStore } from './storage-harness.js';

// The same contract runs against an in-memory database and a database file.
describe.each(['memory', 'file'] as const)('SQLite %s configuration', (mode) => {
  /**
   * One request writing two records commits both at version 0. A request whose expected version
   * of one record is stale is rejected whole: nothing is written and no receipt is kept.
   */
  it('commits every write of a request together and rejects the whole request on a stale version', () => {
    const store = harness(mode);
    const initial = request();
    const batch: CommitRequest = {
      ...initial,
      expected: [...initial.expected, { key: history, version: 'absent' }],
      writes: [
        ...initial.writes,
        { kind: 'put', key: history, value: { before: null }, resources: [] },
      ],
    };
    expect(value(store.persistence.commit(batch)).versions).toEqual([
      { key: collection, version: 0 },
      { key: history, version: 0 },
    ]);

    // The history record is at version 0, not 1: conflict, and still two records, no receipt.
    const stale = {
      ...request('second'),
      expected: [
        { key: collection, version: 0 },
        { key: history, version: 1 },
      ],
    };
    rejects(store.persistence.commit(stale), 'revision-conflict');
    expect(value(store.persistence.readSnapshot()).slots).toHaveLength(2);
    expect(value(store.persistence.receipt('second'))).toBeNull();
    value(store.persistence.close());
    store.remove();
  });

  /**
   * The receipt is checked before versions: a retry returns the original receipt, and a reused ID
   * with another fingerprint is `request-reused`. A request with no writes still commits a new
   * sequence without changing record versions, and is still checked for stale versions.
   */
  it('matches retries by receipt first and commits a no-write request without changing versions', () => {
    const store = harness(mode);
    const first = value(store.persistence.commit(request()));
    expect(value(store.persistence.commit(request()))).toEqual(first);
    rejects(
      store.persistence.commit({ ...request(), fingerprint: digest.parse('b'.repeat(64)) }),
      'request-reused',
    );

    // No writes: sequence 2, no versions, the record stays at version 0.
    const noop = { ...request('noop'), expected: [{ key: collection, version: 0 }], writes: [] };
    expect(value(store.persistence.commit(noop))).toMatchObject({ sequence: 2, versions: [] });
    expect(value(store.persistence.readSnapshot()).slots[0]?.version).toBe(0);

    // No writes, but a stale expected version: conflict.
    rejects(
      store.persistence.commit({
        ...noop,
        request: 'stale-noop',
        expected: [{ key: collection, version: 4 }],
      }),
      'revision-conflict',
    );
    value(store.persistence.close());
    store.remove();
  });

  /**
   * A delete keeps the record as a versioned tombstone, so a create that expects it absent is a
   * conflict and a recreate continues its version. Requests without expected versions, with a
   * duplicate expected key, or with a function value are `invalid-input`.
   */
  it('keeps deleted records as versioned tombstones and rejects malformed requests', () => {
    const store = harness(mode);
    value(store.persistence.commit(request()));
    value(
      store.persistence.commit({
        ...request('delete'),
        expected: [{ key: collection, version: 0 }],
        writes: [{ kind: 'delete', key: collection }],
      }),
    );
    expect(value(store.persistence.readSnapshot()).slots[0]).toMatchObject({
      version: 1,
      deleted: true,
      value: null,
      resources: [],
    });

    // Creating it again as if absent conflicts; recreating from the tombstone gives version 2.
    rejects(store.persistence.commit(request('stale-create')), 'revision-conflict');
    expect(
      value(
        store.persistence.commit({
          ...request('recreate'),
          expected: [{ key: collection, version: 1 }],
        }),
      ).versions,
    ).toEqual([{ key: collection, version: 2 }]);

    // Malformed requests.
    rejects(store.persistence.commit({ ...request('blind'), expected: [] }), 'invalid-input');
    rejects(
      store.persistence.commit({
        ...request('duplicate'),
        expected: [...request().expected, ...request().expected],
      }),
      'invalid-input',
    );
    rejects(
      store.persistence.commit({ ...request('function'), outcome: { f: () => 1 } }),
      'invalid-input',
    );
    value(store.persistence.close());
    store.remove();
  });

  /**
   * A committed request is copied, so later changes to the caller's object are not stored.
   * Snapshots are deeply frozen. A request for another workspace is `invalid-input`. A newer
   * schema version is `unsupported-version` and left as stored; an inconsistent state is
   * `corrupt-record`.
   */
  it('stores a copy of the request, returns frozen snapshots and rejects foreign or unreadable states', () => {
    const store = harness(mode);
    const input = { ...request(), outcome: { title: 'Original' } };
    value(store.persistence.commit(input));
    input.outcome.title = 'Changed externally';
    const snapshot = value(store.persistence.readSnapshot());
    expect(snapshot.receipts[0]?.outcome).toEqual({ title: 'Original' });
    expect(Object.isFrozen(snapshot.slots)).toBe(true);
    expect(Object.isFrozen(snapshot.slots[0]?.value)).toBe(true);
    rejects(store.persistence.commit({ ...request('wrong'), workspace: 'other' }), 'invalid-input');

    // Stored schema version 2: unsupported, and the stored value is not reset.
    const newer = faultStore('none', { ...pristine(), schemaVersion: 2 });
    rejects(newer.persistence.readSnapshot(), 'unsupported-version');
    expect(newer.inspect()).toMatchObject({ schemaVersion: 2 });
    newer.close();

    // Sequence 1 with no receipts: corrupt.
    const corrupt = faultStore('none', { ...pristine(), sequence: 1 });
    rejects(corrupt.persistence.readSnapshot(), 'corrupt-record');
    corrupt.close();
    value(store.persistence.close());
    store.remove();
  });

  /**
   * After close, reads are `storage-unavailable`. Reopening the location finds the commit only
   * for a file database; an in-memory database starts empty.
   */
  it('fails reads after close and keeps commits across reopen only for a file database', () => {
    const store = harness(mode);
    const receipt = value(store.persistence.commit(request()));
    value(store.persistence.close());
    rejects(store.persistence.readSnapshot(), 'storage-unavailable');
    const reopened = value(openSqlite(store.location, workspace));
    const expected = mode === 'file' ? receipt : null;
    expect(value(reopened.receipt('request-one'))).toEqual(expected);
    expect(value(reopened.readSnapshot()).slots.length).toBe(mode === 'file' ? 1 : 0);
    value(reopened.close());
    store.remove();
  });
});

/**
 * A driver that throws on read, write or COMMIT gives `storage-unavailable` and stores nothing. A
 * lost COMMIT acknowledgement also gives `storage-unavailable`, although the commit was stored.
 */
it('reports driver failures as storage-unavailable, rolled back or, after COMMIT, installed', () => {
  (['read', 'write', 'commit'] as const).forEach((fault) => checkRollback(fault));
  const uncertain = faultStore('after-commit');
  rejects(uncertain.persistence.commit(request()), 'storage-unavailable');
  expect(uncertain.inspect()).toMatchObject({
    sequence: 1,
    receipts: [{ request: 'request-one' }],
  });
  uncertain.close();
});

/** Commits through a store that throws at `fault`, and checks the stored state is still empty. */
function checkRollback(fault: 'read' | 'write' | 'commit'): void {
  const store = faultStore(fault);
  rejects(store.persistence.commit(request()), 'storage-unavailable');
  expect(store.inspect()).toMatchObject({ sequence: 0, slots: [], receipts: [] });
  store.close();
}
