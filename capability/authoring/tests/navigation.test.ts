import { describe, it, expect, assert } from 'vitest';
import { z } from 'zod';
import {
  createAuthoring,
  requestSchema,
  failure,
  type Authoring,
  type Json,
  type Receipt,
  type Request,
  type Result,
  type HistoryStatus,
  type Snapshot,
  type StoredRecord,
} from '../contract/index.js';
import {
  harness,
  seed,
  value,
  workspace,
  request,
  put,
  diagram,
  media,
  record,
  key,
  rejects,
} from './fixtures.js';

/** Which way to move through history. */
type Direction = 'undo' | 'redo';

/**
 * The history list each corrupted record holds: a transaction's `transitions` and a head's
 * `participants`.
 */
const REPEATED_HISTORY_FIELDS: ReadonlyMap<string, string> = new Map([
  ['tx:A', 'transitions'],
  ['head:A', 'participants'],
]);

/** Sets a collection's title in one request, reading the current snapshot first. */
async function edit(
  api: Authoring,
  id: string,
  title: string,
  collection = 'demo',
): Promise<Result<Receipt>> {
  return api.apply(
    request(value(await api.read(workspace)), id, [
      put('collection', collection, diagram(collection, title), [media]),
    ]),
  );
}

/** Builds the undo or redo request a client submits from a history status. */
function inverseFromStatus(
  status: HistoryStatus,
  id: string,
  direction: Direction,
): Request {
  const action = status[direction];
  assert(action);
  return requestSchema.parse({
    version: 1,
    workspace,
    request: id,
    actor: { id: 'human', kind: 'human' },
    assets: [],
    expected: action.expected,
    scope: action.scope,
    intent: { kind: direction, transaction: action.transaction },
  });
}

/** Reads the history status, then submits its next undo or redo. */
async function navigate(
  api: Authoring,
  id: string,
  direction: Direction,
): Promise<Result<Receipt>> {
  return api.apply(inverseFromStatus(value(await api.history(workspace)), id, direction));
}

/** Reads the `demo` collection's current value. */
async function title(api: Authoring): Promise<Json> {
  return record(value(await api.read(workspace)), key('collection', 'demo')).value;
}

/** Applies edits `E<from>` up to, but not including, `E<to>`, one after another. */
async function edits(
  api: Authoring,
  from: number,
  to: number,
): Promise<void> {
  for (let index = from; index < to; index++) {
    value(await edit(api, `E${index}`, `E${index}`));
  }
}

/** Lists a snapshot's history records. */
function historyRecords(snapshot: Snapshot): readonly StoredRecord[] {
  return snapshot.records.filter((item) => item.key.kind === 'history');
}

/**
 * Returns the record with its history list repeated (for example `[a, b]` → `[a, b, a, b]`)
 * when it is `tx:A` or `head:A`. Every other record is returned unchanged.
 */
function withRepeatedHistory(item: StoredRecord): StoredRecord {
  const field = REPEATED_HISTORY_FIELDS.get(item.key.id);
  if (!field) return item;
  const data = z.record(z.string(), z.json()).parse(item.value);
  const items = z.array(z.json()).parse(data[field]);
  return { ...item, value: { ...data, [field]: [...items, ...items] } };
}

describe('workspace chronological history', () => {
  /**
   * Adopting history on a workspace with existing edits starts with nothing to undo or redo,
   * leaves content unchanged, and does not keep old transactions. Adopting again changes nothing.
   */
  it('adopts existing state without making old edits selectable and reopens idempotently', async () => {
    const h = harness();
    await seed(h);
    const original = value(await h.api.read(workspace));
    expect(value(await h.api.initializeHistory(workspace))).toMatchObject({
      undo: null,
      redo: null,
    });

    // Two commits: adoption stores navigation, then compaction purges the old history.
    const adopted = value(await h.api.read(workspace));
    expect(adopted.sequence).toBe(original.sequence + 2);
    expect(record(adopted, key('collection', 'demo'))).toEqual(
      record(original, key('collection', 'demo')),
    );
    expect(adopted.records.some((item) => item.key.id === 'tx:seed')).toBe(false);

    value(await h.api.initializeHistory(workspace));
    expect(value(await h.api.read(workspace))).toEqual(adopted);
    h.store.close();
  });

  /**
   * History keeps at most 100 steps. Opening history trims records it does not reach, and undo
   * still works at the limit.
   */
  it('keeps the last 100 steps, trims old history on open, and undo still works', async () => {
    const h = harness();
    await seed(h);

    // 30 edits before adoption: only the navigation record remains afterwards.
    await edits(h.api, 0, 30);
    value(await h.api.initializeHistory(workspace));
    expect(historyRecords(value(await h.api.read(workspace)))).toHaveLength(1);

    // 105 more edits: 100 steps × (transaction + head) + navigation = 201 records.
    await edits(h.api, 30, 135);
    const bounded = value(await h.api.read(workspace));
    expect(historyRecords(bounded)).toHaveLength(201);
    expect(bounded.records.some((item) => item.key.id === 'tx:E34')).toBe(false);

    // Three undos go back from E134 to E131.
    for (const id of ['U1', 'U2', 'U3']) value(await navigate(h.api, id, 'undo'));
    expect(await title(h.api)).toMatchObject({ title: 'E131' });
    expect(value(await h.api.history(workspace)).redo?.transaction).toBe('E132');
    h.store.close();
  }, 60_000);

  /** Undo and redo in order restore each title, and every step writes a new revision. */
  it('A B undo B undo A redo A redo B restores contents with fresh versions', async () => {
    const h = harness();
    await seed(h);
    value(await h.api.initializeHistory(workspace));
    value(await edit(h.api, 'A', 'A'));
    value(await edit(h.api, 'B', 'B'));
    value(await navigate(h.api, 'undo-B', 'undo'));
    expect(await title(h.api)).toMatchObject({ title: 'A', revision: 3 });
    value(await navigate(h.api, 'undo-A', 'undo'));
    expect(await title(h.api)).toMatchObject({ title: 'Original', revision: 4 });
    value(await navigate(h.api, 'redo-A', 'redo'));
    expect(await title(h.api)).toMatchObject({ title: 'A', revision: 5 });
    value(await navigate(h.api, 'redo-B', 'redo'));
    expect(await title(h.api)).toMatchObject({ title: 'B', revision: 6 });
    expect(value(await h.api.history(workspace))).toMatchObject({
      undo: { transaction: 'B' },
      redo: null,
    });
    h.store.close();
  });

  /**
   * A no-op and its replay keep the redo step. A real edit, even in another collection, removes
   * the redo step and its history.
   */
  it('no-op and replay retain redo; a new edit in another collection truncates redo', async () => {
    const h = harness();
    await seed(h, ['demo', 'other']);
    value(await h.api.initializeHistory(workspace));
    value(await edit(h.api, 'A', 'A'));
    value(await navigate(h.api, 'undo-A', 'undo'));

    // Write the current value again: no-op, and the same receipt on replay.
    const state = value(await h.api.read(workspace));
    const unchanged = request(state, 'no-op', [
      put('collection', 'demo', record(state, key('collection', 'demo')).value, [media]),
    ]);
    const receipt = value(await h.api.apply(unchanged));
    expect(receipt.outcome.status).toBe('no-op');
    expect(value(await h.api.apply(unchanged))).toEqual(receipt);
    expect(value(await h.api.history(workspace)).redo?.transaction).toBe('A');

    // Edit the other collection: redo is gone, and so is A's transaction.
    value(await edit(h.api, 'C', 'Changed elsewhere', 'other'));
    expect(value(await h.api.history(workspace))).toMatchObject({
      undo: { transaction: 'C' },
      redo: null,
    });
    const records = value(await h.api.read(workspace)).records;
    expect(records.some((item) => item.key.id === 'tx:A')).toBe(false);
    h.store.close();
  });

  /**
   * Two undos built from the same status race: one commits, one fails. The old status cannot be
   * used again to undo a different step.
   */
  it('two inverse requests from the same status commit once; stale navigation never retargets', async () => {
    const h = harness();
    await seed(h);
    value(await h.api.initializeHistory(workspace));
    value(await edit(h.api, 'A', 'A'));
    const status = value(await h.api.history(workspace));
    const results = await Promise.all([
      h.api.apply(inverseFromStatus(status, 'U1', 'undo')),
      h.api.apply(inverseFromStatus(status, 'U2', 'undo')),
    ]);
    expect(results.filter((item) => item.ok)).toHaveLength(1);
    expect(results.filter((item) => !item.ok)).toHaveLength(1);
    expect(await title(h.api)).toMatchObject({ title: 'Original', revision: 2 });
    rejects(await h.api.apply(inverseFromStatus(status, 'U3', 'undo')), 'revision-conflict');
    h.store.close();
  });

  /** An undo that fails feasibility or fails to commit leaves the snapshot exactly as it was. */
  it('inverse validation or commit failure changes neither content nor cursor', async () => {
    const h = harness();
    await seed(h);
    value(await h.api.initializeHistory(workspace));
    value(await edit(h.api, 'A', 'A'));
    const before = value(await h.api.read(workspace));
    const command = inverseFromStatus(value(await h.api.history(workspace)), 'undo-A', 'undo');
    const invalid = createAuthoring({
      ...h.deps,
      feasibility: { check: async () => failure('constraint-conflict', 'test', 'Cannot render') },
    });
    rejects(await invalid.apply(command), 'constraint-conflict');
    const failed = createAuthoring({
      ...h.deps,
      commits: { commit: async () => failure('storage-unavailable', 'test', 'Cannot commit') },
    });
    rejects(await failed.apply(command), 'storage-unavailable');
    expect(value(await h.api.read(workspace))).toEqual(before);
    h.store.close();
  });

  /**
   * An undo whose acknowledgement is lost still commits. A new facade on the same store sees the
   * redo step, and replaying the undo returns its receipt without undoing again.
   */
  it('reopened facade preserves redo and a lost commit acknowledgement replays only its receipt', async () => {
    const h = harness();
    await seed(h);
    value(await h.api.initializeHistory(workspace));
    value(await edit(h.api, 'A', 'A'));
    const command = inverseFromStatus(value(await h.api.history(workspace)), 'undo-A', 'undo');
    const lost = createAuthoring({
      ...h.deps,
      commits: {
        commit: async (input) => {
          value(await h.deps.commits.commit(input));
          return failure('storage-unavailable', 'test', 'Lost acknowledgement');
        },
      },
    });
    const receipt = value(await lost.apply(command));
    const reopened = createAuthoring(h.deps);
    expect(value(await reopened.initializeHistory(workspace)).redo?.transaction).toBe('A');
    expect(value(await reopened.apply(command))).toEqual(receipt);
    expect(await title(reopened)).toMatchObject({ revision: 2, title: 'Original' });
    h.store.close();
  });

  /**
   * A prepared edit depends on the history navigation record, which every edit updates, so an
   * edit to another collection makes it stale.
   */
  it('a prepared edit cannot reuse its hash after history changes in another collection', async () => {
    const h = harness();
    await seed(h, ['demo', 'other']);
    value(await h.api.initializeHistory(workspace));
    const command = request(value(await h.api.read(workspace)), 'prepared', [
      put('collection', 'demo', diagram('demo', 'Prepared'), [media]),
    ]);
    const prepared = value(await h.api.prepare(command));
    assert('candidateHash' in prepared);
    value(await edit(h.api, 'foreign', 'Other edit', 'other'));
    const before = value(await h.api.read(workspace));
    rejects(
      await h.api.apply(command, { candidateHash: prepared.candidateHash }),
      'revision-conflict',
    );
    expect(value(await h.api.read(workspace))).toEqual(before);
    h.store.close();
  });

  /**
   * Two facades adopt history at once: the second adopts right after the first's first receipt
   * lookup. The first still succeeds and reports the same history status as the second.
   */
  it('concurrent startup adopts once even when the first receipt read predates adoption', async () => {
    const h = harness();
    await seed(h);
    // Only the first receipt lookup triggers the competing adoption. The flag is flipped when
    // that lookup reaches the check, so exactly one adoption is triggered.
    let first = true;
    const racing = createAuthoring({
      ...h.deps,
      receipts: {
        find: async (workspace, id) => {
          const receipt = await h.deps.receipts.find(workspace, id);
          if (first) {
            first = false;
            value(await h.api.initializeHistory(workspace));
          }
          return receipt;
        },
      },
    });
    expect(value(await racing.initializeHistory(workspace))).toEqual(
      value(await h.api.history(workspace)),
    );
    h.store.close();
  });

  /** A transaction or head that lists the same record twice fails when history is opened. */
  it('reopening rejects repeated retained participants before exposing history controls', async () => {
    const h = harness();
    await seed(h);
    value(await h.api.initializeHistory(workspace));
    value(await edit(h.api, 'A', 'A'));
    const snapshot = value(await h.api.read(workspace));
    const corrupt = { ...snapshot, records: snapshot.records.map(withRepeatedHistory) };
    const reopened = createAuthoring({
      ...h.deps,
      snapshots: { read: async () => ({ ok: true, value: corrupt }) },
    });
    const result = await reopened.initializeHistory(workspace);
    expect(result.ok).toBe(false);
    h.store.close();
  });
});
