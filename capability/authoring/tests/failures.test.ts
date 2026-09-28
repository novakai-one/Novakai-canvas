import { describe, it, expect, vi } from 'vitest';
import {
  createAuthoring,
  failure,
  plannerId,
  requestSchema,
  workspaceId,
  type Diagnostic,
  type Snapshot,
  type RecordKey,
  type WorkspaceId,
  type Result,
  type ResourceLease,
  type FeasibilityReport,
} from '../contract/index.js';
import { createNodeIdentity } from '../adapters/node-identity.js';
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
} from './fixtures.js';
import { gate } from './gates.js';

// Failures from collaborators and from bad input, and how each one reaches the caller.
describe('Authoring resource and failure boundaries', () => {
  /**
   * A hard feasibility failure rejects the request, and apply asks for no preview. Soft
   * adjustments are kept in the receipt. A no-op never reaches the feasibility check.
   */
  it('rejects a hard feasibility failure, keeps soft adjustments in the receipt, and skips the check for a no-op', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'hard', [
      put('collection', 'demo', diagram('demo', 'Changed'), [media]),
    ]);

    // Hard failure: rejected, called with preview `false`, no receipt. The check always fails.
    const check = vi.fn(
      async (
        _candidate: Snapshot,
        _changed: readonly RecordKey[],
        _preview: boolean,
      ): Promise<Result<FeasibilityReport>> => {
        void [_candidate, _changed, _preview];
        return failure('constraint-conflict', 'route', 'Locked route blocked');
      },
    );
    const api = createAuthoring({ ...h.deps, feasibility: { check } });
    rejects(await api.apply(edit), 'constraint-conflict');
    expect(check.mock.calls[0]).toHaveLength(3);
    expect(check.mock.calls[0]?.[2]).toBe(false);
    expect(value(await api.receipt(workspace, 'hard'))).toBeNull();

    // Soft adjustment: committed, with its warning and geometry diff in the receipt.
    const warning: Diagnostic = {
      code: 'constraint-conflict',
      path: 'soft-position',
      targets: ['demo'],
      message: 'Soft preference adjusted',
      recovery: 'Review preview',
      traceId: null,
    };
    const soft = createAuthoring({
      ...h.deps,
      feasibility: {
        check: async () => ({
          ok: true,
          value: { warnings: [warning], diff: { moved: ['demo'] }, preview: null },
        }),
      },
    });
    const saved = value(await soft.apply({ ...edit, request: 'soft' }));
    expect(saved.outcome.warnings).toEqual([warning]);
    expect(saved.outcome.diff).toMatchObject({ geometry: { moved: ['demo'] } });

    // No-op: the failing check is not called again.
    const latest = value(await api.read(workspace));
    const data = record(latest, key('collection', 'demo'));
    value(
      await api.apply(
        request(latest, 'noop', [put('collection', 'demo', data.value, data.resources)]),
      ),
    );
    expect(check).toHaveBeenCalledTimes(1);
    h.store.close();
  });

  /**
   * Missing asset bytes, and assets the lease does not cover (including assets history still
   * needs), reject. An acquired lease is released once when the attempt finishes, whether it
   * failed or succeeded; when the attempt reaches commit, the lease is held until the commit
   * finishes.
   */
  it('rejects missing or uncovered assets, and releases each lease once after the commit finishes', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'media', [
      put('collection', 'demo', diagram('demo', 'Changed'), [media]),
    ]);

    // The asset's bytes are missing.
    rejects(
      await createAuthoring({
        ...h.deps,
        resources: { acquire: async () => failure('missing-asset', 'digest', 'Missing source') },
      }).apply(edit),
      'missing-asset',
    );

    // The lease covers no assets: rejected, and the lease is still released.
    const release = vi.fn(async (): Promise<Result<void>> => ({ ok: true, value: undefined }));
    const acquire = vi.fn(async (): Promise<Result<ResourceLease>> => ({
      ok: true,
      value: { pins: {}, reads: [], covered: [], release },
    }));
    rejects(
      await createAuthoring({ ...h.deps, resources: { acquire } }).apply(edit),
      'missing-asset',
    );
    expect(release).toHaveBeenCalledTimes(1);

    // The lease covers the asset: committed, and released again.
    acquire.mockResolvedValue({
      ok: true,
      value: { pins: {}, reads: [], covered: [media], release },
    });
    value(await createAuthoring({ ...h.deps, resources: { acquire } }).apply(edit));
    expect(release).toHaveBeenCalledTimes(2);

    // Deleting the collection: history keeps its asset, so a lease that covers nothing rejects.
    const current = value(await h.api.read(workspace));
    const deletion = request(current, 'retention', [
      { kind: 'delete', key: key('collection', 'demo') },
      put('catalog', 'catalog', catalog([])),
    ]);
    acquire.mockResolvedValue({ ok: true, value: { pins: {}, reads: [], covered: [], release } });
    rejects(
      await createAuthoring({ ...h.deps, resources: { acquire } }).apply(deletion),
      'missing-asset',
    );
    expect(record(value(await h.api.read(workspace)), key('collection', 'demo')).deleted).toBe(
      false,
    );

    // Hold the commit open: the lease is not released until the commit finishes. A release
    // that throws does not undo the committed result.
    const entered = gate();
    const terminal = gate();
    const delayedRelease = vi.fn(async (): Promise<Result<void>> => {
      throw new Error('release failed');
    });
    const delayed = createAuthoring({
      ...h.deps,
      resources: {
        acquire: async () => ({
          ok: true,
          value: { pins: {}, reads: [], covered: [media], release: delayedRelease },
        }),
      },
      commits: {
        // Signals that commit was reached, waits for the test, then commits for real.
        commit: async (commit) => {
          entered.open();
          await terminal.promise;
          return h.deps.commits.commit(commit);
        },
      },
    });
    const pending = delayed.apply(deletion);
    await entered.promise;
    expect(delayedRelease).not.toHaveBeenCalled();
    terminal.open();
    expect(value(await pending).outcome.status).toBe('committed');
    expect(delayedRelease).toHaveBeenCalledTimes(1);
    h.store.close();
  });

  /**
   * Cancellation before commit rejects without a receipt. After a commit, neither a later
   * cancellation nor a failed notification changes the success, and a retry returns the same
   * receipt without publishing again.
   */
  it('rejects a request cancelled before commit, and keeps a committed success despite later cancellation or notification failure', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'cancel', [
      put('collection', 'demo', diagram('demo', 'Changed'), [media]),
    ]);

    // Cancelled before commit.
    const cancelled = vi.fn(() => true);
    rejects(
      await createAuthoring({ ...h.deps, cancellation: { cancelled } }).apply(edit),
      'cancelled',
    );
    expect(value(await h.api.receipt(workspace, 'cancel'))).toBeNull();

    // Not cancelled; publishing cancels the request and then throws.
    cancelled.mockReturnValue(false);
    const publish = vi.fn(async (): Promise<Result<void>> => {
      cancelled.mockReturnValue(true);
      throw new Error('lost hint');
    });
    const api = createAuthoring({
      ...h.deps,
      cancellation: { cancelled },
      notifications: { publish },
    });
    const first = value(await api.apply(edit));
    expect(first.outcome.status).toBe('committed');

    // The retry finds the receipt first, so cancellation does not apply and nothing is published.
    expect(value(await api.apply(edit))).toEqual(first);
    expect(publish).toHaveBeenCalledTimes(1);
    h.store.close();
  });

  /**
   * Bad input and collaborator faults become bounded failures that reveal no private details.
   * Input is copied before the first await, so a caller changing it afterwards has no effect.
   */
  it('turns malformed, oversized or unsupported input and collaborator faults into safe failures, and copies input before awaiting', async () => {
    const h = harness();
    await seed(h);
    const before = value(await h.api.read(workspace));
    const edit = request(before, 'detached', [
      put('collection', 'demo', diagram('demo', 'Changed'), [media]),
    ]);

    // Unsupported version, and an unknown field holding NaN.
    rejects(await h.api.apply({ ...edit, version: 2 }), 'unsupported-version');
    rejects(await h.api.apply({ ...edit, extra: NaN }), 'invalid-input');

    // A 16 MB payload passes the schema but breaks the JSON size limit.
    const oversized = {
      ...edit,
      intent: {
        kind: 'change',
        planner: 'fixture',
        payload: { writes: [], reads: [], warnings: [], diff: 'x'.repeat(16 * 1024 * 1024) },
      },
    };
    expect(requestSchema.safeParse(oversized).success).toBe(true);
    rejects(await h.api.apply(oversized), 'invalid-input');

    // Storage returns a snapshot for another workspace.
    const wrongWorkspace = createAuthoring({
      ...h.deps,
      snapshots: {
        read: async () => ({
          ok: true,
          value: { ...before, workspace: workspaceId.parse('other') },
        }),
      },
    });
    rejects(await wrongWorkspace.apply(edit), 'corrupt-record');

    // A getter is rejected without being called; a cycle is rejected.
    const getter = vi.fn(() => 1);
    const unsafe = Object.defineProperty({ ...edit }, 'extra', { enumerable: true, get: getter });
    rejects(await h.api.apply(unsafe), 'invalid-input');
    expect(getter).not.toHaveBeenCalled();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    rejects(await h.api.apply(cyclic), 'invalid-input');

    // A planner that throws: a generic failure without the thrown message.
    const bad = createAuthoring({
      ...h.deps,
      planners: [
        {
          id: plannerId.parse('fixture'),
          // Fails with a message that must never reach the caller.
          plan: async () => {
            throw new Error('private provider details');
          },
        },
      ],
    });
    const failed = await bad.apply(edit);
    rejects(failed, 'storage-unavailable');
    expect(JSON.stringify(failed)).not.toContain('private provider details');

    // Change the caller's request while Authoring waits on storage: the stored actor is unchanged.
    const waiting = gate();
    const entered = gate();
    // Signals that the snapshot read started, then waits for the test before reading.
    const read = vi.fn(async (workspace: WorkspaceId) => {
      entered.open();
      await waiting.promise;
      return h.deps.snapshots.read(workspace);
    });
    const api = createAuthoring({ ...h.deps, snapshots: { read } });
    const mutable = { ...structuredClone(edit), actor: { ...edit.actor } };
    const pending = api.apply(mutable);
    await entered.promise;
    mutable.actor.kind = 'agent';
    waiting.open();
    const committed = value(await pending);
    expect(
      record(value(await h.api.read(workspace)), key('history', 'tx:detached')).value,
    ).toMatchObject({ actor: { kind: 'human' } });
    expect(value(await h.api.apply(edit))).toEqual(committed);

    // A request ID of 120 characters is accepted; 121 is rejected.
    const maximum = {
      ...edit,
      request: 'r'.repeat(120),
      expected: [],
      scope: [],
      intent: {
        kind: 'change',
        planner: 'fixture',
        payload: { writes: [], reads: [], diff: [], warnings: [] },
      },
    };
    expect(value(await h.api.apply(maximum)).request).toHaveLength(120);
    rejects(await h.api.apply({ ...maximum, request: 'r'.repeat(121) }), 'invalid-input');

    // The Node hasher gives the standard SHA-256; a hasher that throws becomes a failure.
    const identity = createNodeIdentity();
    expect(value(identity.hash.digest('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    rejects(
      createNodeIdentity(() => {
        throw new Error('hash failure');
      }).hash.digest('abc'),
      'storage-unavailable',
    );
    h.store.close();
  });
});
