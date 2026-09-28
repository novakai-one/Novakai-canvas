import { describe, it, expect, vi } from 'vitest';
import { createAuthoring, failure } from '../contract/index.js';
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
import { inverse, replaceHistoryBefore } from './history-fixtures.js';

// Undo and redo: new requests that restore earlier images, never a rewind of storage.
describe('Authoring reversible transactions', () => {
  /**
   * Undo restores both records the change touched, with their assets, under a new version. Redo
   * moves both to a newer version; the first record's content and asset are checked. The
   * transaction record keeps the assets of both images.
   */
  it('undoes every record a change touched, with its assets, and redoes it under newer versions', async () => {
    const h = harness();
    await seed(h, ['demo', 'other']);
    const before = value(await h.api.read(workspace));
    const demoKey = key('collection', 'demo');
    const otherKey = key('collection', 'other');
    const keys = [demoKey, otherKey];

    // One change edits both collections and switches them to the alternate asset.
    value(
      await h.api.apply(
        request(before, 'pair', [
          put('collection', 'demo', diagram('demo', 'First', alternate), [alternate]),
          put('collection', 'other', diagram('other', 'Second', alternate), [alternate]),
        ]),
      ),
    );
    const changed = value(await h.api.read(workspace));

    // Undo: both collections are back to 'Original' with the original asset, at version 2.
    value(await h.api.undo(inverse(changed, 'undo-pair', 'pair', 'undo', keys)));
    const undone = value(await h.api.read(workspace));
    expect(keys.map((key) => record(undone, key))).toEqual([
      expect.objectContaining({
        version: 2,
        value: expect.objectContaining({ title: 'Original', revision: 2 }),
        resources: [media],
      }),
      expect.objectContaining({
        version: 2,
        value: expect.objectContaining({ title: 'Original', revision: 2 }),
        resources: [media],
      }),
    ]);
    expect(record(undone, key('history', 'tx:pair')).resources.toSorted()).toEqual(
      [media, alternate].toSorted(),
    );

    // Redo: the change is back at version 3, and the head is active again.
    value(await h.api.redo(inverse(undone, 'redo-pair', 'pair', 'redo', keys)));
    const redone = value(await h.api.read(workspace));
    expect(keys.map((key) => record(redone, key).version)).toEqual([3, 3]);
    expect(record(redone, demoKey)).toMatchObject({
      value: { title: 'First' },
      resources: [alternate],
    });
    expect(record(redone, key('history', 'head:pair')).value).toMatchObject({
      state: 'active',
      last: 'redo-pair',
    });
    h.store.close();
  });

  /**
   * An undo or redo that cannot apply is rejected: an infeasible or invalid inverse (the sequence
   * is checked unchanged afterwards), a second undo, a redo after an edit in between, an unknown
   * change, and a corrupt before-image (the record is checked unchanged afterwards).
   */
  it('rejects an infeasible, invalid, repeated, diverged, unknown or corrupt undo or redo', async () => {
    const h = harness();
    await seed(h);
    const keys = [key('collection', 'demo')];
    const before = value(await h.api.read(workspace));
    value(
      await h.api.apply(
        request(before, 'edit', [put('collection', 'demo', diagram('demo', 'Changed'), [media])]),
      ),
    );
    const current = value(await h.api.read(workspace));
    const undo = inverse(current, 'undo', 'edit', 'undo', keys);

    // The old geometry is no longer feasible: the check always fails.
    const check = vi.fn(async () =>
      failure<never>('constraint-conflict', 'locked-route', 'Old geometry infeasible'),
    );
    rejects(
      await createAuthoring({ ...h.deps, feasibility: { check } }).undo(undo),
      'constraint-conflict',
    );
    expect(check).toHaveBeenCalledTimes(1);

    // The restored content fails validation: the validator always fails.
    const validation = vi.fn(async () =>
      failure<never>('invariant-violation', 'admission', 'Retained source unavailable'),
    );
    rejects(
      await createAuthoring({ ...h.deps, validation: { validate: validation } }).undo(undo),
      'invariant-violation',
    );
    expect(value(await h.api.read(workspace)).sequence).toBe(current.sequence);

    // Undo once succeeds; undoing the same change again is a conflict.
    value(await h.api.undo(undo));
    const undone = value(await h.api.read(workspace));
    rejects(await h.api.undo(inverse(undone, 'double', 'edit', 'undo', keys)), 'revision-conflict');

    // An edit after the undo: redo is now a conflict.
    value(
      await h.api.apply(
        request(undone, 'divergent', [
          put('collection', 'demo', diagram('demo', 'Divergent'), [media]),
        ]),
      ),
    );
    const divergent = value(await h.api.read(workspace));
    rejects(
      await h.api.redo(inverse(divergent, 'redo', 'edit', 'redo', keys)),
      'revision-conflict',
    );

    // Undoing a change that was never made.
    rejects(
      await h.api.undo(inverse(divergent, 'missing', 'absent', 'undo', keys)),
      'unknown-reference',
    );

    // A transaction whose before-image is another record's: rejected as corrupt, nothing changes.
    const initial = value(await h.api.read(workspace));
    value(
      await h.api.apply(
        request(initial, 'metadata-init', [
          put('workspace', 'a', { label: 'A' }),
          put('workspace', 'b', { label: 'B' }),
        ]),
      ),
    );
    value(
      await h.api.apply(
        request(value(await h.api.read(workspace)), 'metadata-edit', [
          put('workspace', 'a', { label: 'A edited' }),
        ]),
      ),
    );
    const metadata = value(await h.api.read(workspace));
    const malformed = replaceHistoryBefore(metadata, 'metadata-edit', key('workspace', 'b'));
    const corrupt = createAuthoring({
      ...h.deps,
      // Every read returns the corrupted copy.
      snapshots: { read: async () => ({ ok: true, value: malformed }) },
    });
    rejects(
      await corrupt.undo(
        inverse(metadata, 'wrong-image', 'metadata-edit', 'undo', [key('workspace', 'a')]),
      ),
      'corrupt-record',
    );
    expect(record(value(await h.api.read(workspace)), key('workspace', 'a'))).toMatchObject({
      version: 1,
      value: { label: 'A edited' },
    });
    h.store.close();
  });
});
