import { describe, it, expect, assert } from 'vitest';
import { createAuthoring, requestSchema, type Write } from '../contract/index.js';
import { gate } from './gates.js';
import {
  harness,
  seed,
  value,
  rejects,
  request,
  diagram,
  catalog,
  put,
  key,
  record,
  workspace,
  media,
  liveCollections,
} from './fixtures.js';

// Admission: what a change needs before it commits, and what a commit stores.
describe('Authoring admission', () => {
  /**
   * Seeding one collection writes the collection and the catalog in one commit, both at version
   * 0. The snapshot read back has a frozen records list and a frozen collection value.
   */
  it('creates a collection and its catalog together, and reads back a frozen snapshot', async () => {
    const h = harness();
    const receipt = await seed(h);
    const read = value(await h.api.read(workspace));

    // Four versions: collection, catalog, the transaction record and its head.
    expect(receipt.outcome.status).toBe('committed');
    expect(receipt.versions).toHaveLength(4);
    expect(liveCollections(read)).toHaveLength(1);
    expect(record(read, key('collection', 'demo'))).toMatchObject({
      version: 0,
      value: { revision: 0, title: 'Original' },
    });
    expect(record(read, key('catalog', 'catalog'))).toMatchObject({
      version: 0,
      value: { entries: [{ collection: 'demo' }] },
    });

    // The records list and one collection value are frozen.
    expect(Object.isFrozen(read.records)).toBe(true);
    expect(Object.isFrozen(record(read, key('collection', 'demo')).value)).toBe(true);
    expect(h.store.close().ok).toBe(true);
  });

  /**
   * A valid edit from an agent commits. A later edit (from the default human actor) with an
   * invalid collection is rejected as `invariant-violation`, gets no receipt and leaves the
   * collection's version unchanged.
   */
  it('commits a valid agent edit, and rejects an invalid edit without a receipt or change', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));

    // A valid edit from an agent commits and moves the collection to version 1.
    const edit = request(
      before,
      'agent-edit',
      [put('collection', 'demo', diagram('demo', 'Agent update'), [media])],
      { actor: { id: 'agent', kind: 'agent' } },
    );
    value(await h.api.apply(edit));
    expect(record(value(await h.api.read(workspace)), key('collection', 'demo'))).toMatchObject({
      version: 1,
      value: { title: 'Agent update', revision: 1 },
    });

    // A collection without its required shape fails domain validation.
    const invalid = request(value(await h.api.read(workspace)), 'bad-edit', [
      put('collection', 'demo', { id: 'demo', title: 'Missing required shape' }, [media]),
    ]);
    rejects(await h.api.apply(invalid), 'invariant-violation');
    expect(value(await h.api.receipt(workspace, 'bad-edit'))).toBeNull();
    expect(record(value(await h.api.read(workspace)), key('collection', 'demo')).version).toBe(1);
    h.store.close();
  });

  /**
   * Each malformed or out-of-bounds request is rejected with its own code, and nothing commits.
   */
  it('rejects missing or stale versions, writes outside scope, reserved records and duplicate writes', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'edit', [
      put('collection', 'demo', diagram('demo', 'Changed'), [media]),
    ]);

    // A write whose version the author did not observe.
    rejects(await h.api.apply({ ...edit, expected: [] }), 'invalid-input');
    // A write whose observed version is out of date.
    rejects(
      await h.api.apply({ ...edit, expected: [{ key: key('collection', 'demo'), version: 8 }] }),
      'revision-conflict',
    );
    // A write outside the request's scope.
    rejects(await h.api.apply({ ...edit, scope: [] }), 'permission-denied');
    // A write to a history record, which only Authoring may write.
    const reserved = request(before, 'reserved', [put('history', 'illegal', {})]);
    rejects(await h.api.apply(reserved), 'permission-denied');
    // Two writes to the same record.
    const duplicate = {
      ...edit,
      intent: {
        ...edit.intent,
        payload: {
          writes: [put('collection', 'demo', diagram()), put('collection', 'demo', diagram())],
          reads: [],
          diff: [],
          warnings: [],
        },
      },
    };
    rejects(await h.api.apply(duplicate), 'invalid-input');

    expect(value(await h.api.read(workspace)).sequence).toBe(before.sequence);
    h.store.close();
  });

  /**
   * Writing an unchanged value gives a `no-op` receipt and leaves every stored record unchanged
   * (the receipt itself still advances the workspace sequence). Deleting a collection leaves a
   * tombstone, and recreating it continues from the tombstone's version.
   */
  it('gives a no-op receipt for an unchanged write, and keeps versions increasing through delete and restore', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const original = record(before, key('collection', 'demo'));

    // Writing the same value: no-op, no versions, stored records unchanged.
    const noOp = value(
      await h.api.apply(
        request(before, 'same', [put('collection', 'demo', original.value, [media])]),
      ),
    );
    expect(noOp.outcome).toMatchObject({ status: 'no-op', transaction: null });
    expect(noOp.versions).toEqual([]);
    expect(value(await h.api.read(workspace)).records).toEqual(before.records);

    // Deleting the collection (and emptying the catalog) leaves a tombstone at version 1.
    const deleted = value(await h.api.read(workspace));
    const deletes: readonly Write[] = [
      { kind: 'delete', key: key('collection', 'demo') },
      put('catalog', 'catalog', catalog([])),
    ];
    value(await h.api.apply(request(deleted, 'delete', deletes)));
    const tombstone = value(await h.api.read(workspace));
    expect(record(tombstone, key('collection', 'demo'))).toMatchObject({
      version: 1,
      deleted: true,
      value: null,
    });

    // Recreating it moves to version 2, not back to 0.
    value(
      await h.api.apply(
        request(tombstone, 'restore', [
          put('collection', 'demo', diagram(), [media]),
          put('catalog', 'catalog', catalog(['demo'])),
        ]),
      ),
    );
    expect(record(value(await h.api.read(workspace)), key('collection', 'demo'))).toMatchObject({
      version: 2,
      deleted: false,
      value: { revision: 2 },
    });
    h.store.close();
  });

  /**
   * A prepared request is rejected once its records change, or when its candidate hash differs.
   * A dependency the validator reports (the catalog) is checked at commit, even when it changes
   * while the request is in flight.
   */
  it('rejects a stale prepared request, a changed candidate hash, and a changed dependency', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'prepared', [
      put('collection', 'demo', diagram('demo', 'Prepared'), [media]),
    ]);

    // Prepare, then let another request change the collection: the prepared one is now stale.
    const prepared = value(await h.api.prepare(edit));
    expect(prepared).toHaveProperty('candidateHash');
    const checked = requestSchema.parse({ ...edit, request: 'other' });
    value(await h.api.apply(checked));
    rejects(await h.api.apply(edit), 'revision-conflict');

    // A candidate hash that does not match the candidate.
    const latest = value(await h.api.read(workspace));
    const fresh = request(latest, 'fresh', [
      put('collection', 'demo', diagram('demo', 'Newer'), [media]),
    ]);
    rejects(await h.api.apply(fresh, { candidateHash: 'f'.repeat(64) }), 'revision-conflict');

    // A validator that reports a dependency version the snapshot does not have.
    const reader = createAuthoring({
      ...h.deps,
      validation: {
        // Always passes, and depends on catalog version 99.
        validate: async () => ({
          ok: true,
          value: [{ key: key('catalog', 'catalog'), version: 99 }],
        }),
      },
    });
    rejects(await reader.apply(fresh), 'revision-conflict');

    // The matching candidate hash commits.
    const exact = value(await h.api.prepare(fresh));
    assert('candidateHash' in exact);
    value(await h.api.apply(fresh, { candidateHash: exact.candidateHash }));

    // Hold a collection edit at the feasibility check while the catalog changes underneath it.
    const raced = value(await h.api.read(workspace));
    const entered = gate();
    const finish = gate();
    const api = createAuthoring({
      ...h.deps,
      feasibility: {
        // Signals that the check was reached, then waits until the test lets it finish.
        check: async () => {
          entered.open();
          await finish.promise;
          return { ok: true, value: { warnings: [], diff: [], preview: null } };
        },
      },
    });
    const pending = api.apply(
      request(raced, 'catalog-dependent', [
        put('collection', 'demo', diagram('demo', 'Dependent'), [media]),
      ]),
    );
    await entered.promise;
    value(
      await h.api.apply(
        request(raced, 'catalog-change', [
          put('catalog', 'catalog', {
            schemaVersion: 1,
            id: 'catalog',
            revision: 0,
            folders: [{ id: 'folder', title: 'New folder', order: 0 }],
            entries: [{ collection: 'demo', order: 0, archived: false }],
          }),
        ]),
      ),
    );
    finish.open();
    rejects(await pending, 'revision-conflict');
    h.store.close();
  });
});
