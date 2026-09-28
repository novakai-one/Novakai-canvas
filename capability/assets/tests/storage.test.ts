import { describe, it, expect } from 'vitest';
import { openAssets, createAssets } from '../contract/index.js';
import { harness } from './harness.js';
import { submission, value, rejects, unavailable } from './fixtures.js';

/** Storage: reopening, damaged files and failures that must not look like success. */
describe('storage', () => {
  /**
   * After close, `openAssets` on the same directory reads the same blob. Then, through the
   * reopened instance: overwritten bytes are `corrupt-asset` for both resolve and restaging, and a
   * deleted file is `missing-asset`. Finally, after closing it and deleting the schema row,
   * `openAssets` fails with `corrupt-asset`.
   */
  it('reopens durable files and refuses missing or corrupted exact resources', async () => {
    // Arrange: stage and read one blob, then close.
    const fixture = harness();
    const admission = value(await fixture.assets.stage(submission()));
    const id = admission.descriptor.digest;
    const before = value(fixture.assets.resolve(id));
    value(fixture.assets.close());
    // Reopen.
    const reopened = value(openAssets(fixture.root));
    expect(value(reopened.resolve(id))).toEqual(before);
    // Corrupted file.
    fixture.corrupt(id);
    rejects(reopened.resolve(id), 'corrupt-asset');
    rejects(await reopened.stage(submission()), 'corrupt-asset');
    // Deleted file.
    fixture.unlink(id);
    rejects(reopened.resolve(id), 'missing-asset');
    // Missing schema row.
    value(reopened.close());
    fixture.removeSchema();
    rejects(openAssets(fixture.root), 'corrupt-asset');
  });

  /**
   * Failures that must not look like success, each `storage-unavailable`: a reachability reader
   * that fails or throws (collection deletes nothing, so the blob still resolves), storage whose
   * transactions fail (staging fails), and factories that cannot open the location (the files
   * factory throws first, so the database factory is never called).
   */
  it('returns typed native-open and reachability failures without false collection success', async () => {
    // Arrange: stage one blob.
    const fixture = harness();
    const id = value(await fixture.assets.stage(submission())).descriptor.digest;
    // Reader failure.
    rejects(fixture.assets.collectUnreferenced(unavailable), 'storage-unavailable');
    // Storage failure.
    const failing = createAssets({
      ...fixture.deps,
      storage: { transact: unavailable, close: unavailable },
    });
    rejects(await failing.stage(submission()), 'storage-unavailable');
    // The failed collection above deleted nothing: the blob still resolves.
    expect(value(fixture.assets.resolve(id)).descriptor.digest).toBe(id);
    // Location cannot be opened.
    rejects(
      openAssets(fixture.root, {
        files: () => {
          throw new Error('Disk unavailable');
        },
        database: () => {
          throw new Error('No database');
        },
      }),
      'storage-unavailable',
    );
    // Reader throws.
    rejects(
      fixture.assets.collectUnreferenced(() => {
        throw new Error('Reader failed');
      }),
      'storage-unavailable',
    );
    expect(value(fixture.assets.resolve(id)).descriptor.digest).toBe(id);
  });
});
