import { expect, assert, onTestFinished } from 'vitest';
import {
  createAuthoring,
  recordId,
  workspaceId,
  digest,
  requestId,
  actorId,
  plannerId,
  requestSchema,
  type Authoring,
  type Dependencies,
  type Digest,
  type Json,
  type Request,
  type Snapshot,
  type StoredRecord,
  type RecordKey,
  type Write,
  type Result,
  type Receipt,
  type ErrorCode,
} from '../contract/index.js';
import { createNodeIdentity } from '../adapters/node-identity.js';
import { openStore, storageRoles } from './storage-fixture.js';
import { fixturePlanner, domainValidator } from './domain-fixture.js';
import type { Persistence } from '@novakai/canvas-persistence';

/** The workspace every test uses. */
export const workspace = workspaceId.parse('workspace');

/** The digest of the theme asset every seeded diagram pins. */
export const media = digest.parse('a'.repeat(64));

/** A second asset digest, for tests that switch a diagram to another theme asset. */
export const alternate = digest.parse('b'.repeat(64));

/** A test Authoring with its collaborators and the SQLite store behind them. */
export interface Harness {
  readonly api: Authoring;
  readonly deps: Dependencies;
  /** The store behind `deps`. Tests only close it; everything else goes through `api`. */
  readonly store: Pick<Persistence, 'close'>;
}

/**
 * Returns the value of a successful result. The test fails immediately on a failed result, so it
 * never continues with a made-up value.
 *
 * @param result - The result to unwrap.
 * @returns The result's value.
 * @throws AssertionError, showing the whole result, when it failed.
 */
export function value<T>(result: Result<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

/**
 * Expects a failed result with the given code and no value. Tests match on codes, never on
 * message text.
 *
 * @param result - The result to check.
 * @param code - The expected failure code.
 * @throws AssertionError when the result succeeded, has another code, or carries a value.
 */
export function rejects(
  result: Result<unknown>,
  code: ErrorCode,
): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(result).not.toHaveProperty('value');
}

/**
 * Builds a checked record key through the public schema, not a private helper.
 *
 * @param kind - The record kind.
 * @param id - The record ID.
 * @returns The key.
 * @throws ZodError when the ID is invalid.
 */
export function key(
  kind: RecordKey['kind'],
  id: string,
): RecordKey {
  return { kind, id: recordId.parse(id) };
}

/**
 * Builds a small diagram that Model accepts: two steps joined by one flow, in one section, with
 * a pinned theme.
 *
 * @param id - The diagram ID.
 * @param title - The diagram title.
 * @param themeDigest - The digest of the theme asset.
 * @returns The diagram as JSON.
 */
export function diagram(
  id = 'demo',
  title = 'Original',
  themeDigest: Digest = media,
): Json {
  return {
    schemaVersion: 1,
    id,
    revision: 0,
    title,
    theme: { id: 'paper', version: '1', digest: `sha256:${themeDigest}`, roles: ['neutral'] },
    arrangement: { algorithm: 'grid', constraints: [] },
    objects: [
      { id: 'a', kind: 'step', label: 'Start' },
      { id: 'b', kind: 'step', label: 'End' },
    ],
    relationships: [
      {
        id: 'ab',
        kind: 'flow',
        label: 'continues',
        source: { object: 'a' },
        target: { object: 'b' },
      },
    ],
    sections: [
      {
        id: 'main',
        title: 'Process',
        mode: 'flow',
        layout: { algorithm: 'flow', constraints: [] },
        appearances: [{ object: 'a' }, { object: 'b' }],
        wires: [{ relationship: 'ab' }],
      },
    ],
  };
}

/**
 * Builds a catalog with one entry for each collection.
 *
 * @param ids - The collection IDs, in order.
 * @returns The catalog as JSON.
 */
export function catalog(ids: readonly string[]): Json {
  return {
    schemaVersion: 1,
    id: 'catalog',
    revision: 0,
    folders: [],
    // One unarchived entry per collection, all at order 0.
    entries: ids.map((collection) => ({ collection, order: 0, archived: false })),
  };
}

/**
 * Builds a `put` write. Only tests build storage writes directly; real users submit intents.
 *
 * @param kind - The record kind.
 * @param id - The record ID.
 * @param data - The value to store.
 * @param resources - The asset digests the value uses. Defaults to none.
 * @returns The write.
 * @throws ZodError when the ID is invalid.
 */
export function put(
  kind: RecordKey['kind'],
  id: string,
  data: Json,
  resources: readonly Digest[] = [],
): Write {
  return { kind: 'put', key: key(kind, id), value: data, resources };
}

/**
 * Builds a change request for the test planner, which proposes exactly the given writes.
 *
 * The request expects each written record's current version in `snapshot` and scopes exactly
 * those records. The test planner is never registered in production.
 *
 * @param snapshot - The snapshot the author saw.
 * @param id - The request ID.
 * @param writes - The writes the planner will propose.
 * @param extra - Request fields to override, applied last.
 * @returns The checked request.
 * @throws ZodError when the request is invalid.
 */
export function request(
  snapshot: Snapshot,
  id: string,
  writes: readonly Write[],
  extra: Readonly<Record<string, Json>> = {},
): Request {
  // The written records are both the scope and the expected versions.
  const targets = writes.map((write) => write.key);
  return requestSchema.parse({
    workspace,
    request: requestId.parse(id),
    actor: { id: actorId.parse('human'), kind: 'human' },
    version: 1,
    scope: targets,
    expected: targets.map((target) => observed(snapshot, target)),
    assets: [],
    intent: {
      kind: 'change',
      planner: plannerId.parse('fixture'),
      payload: { writes, reads: [], diff: { kind: 'change' }, warnings: [] },
    },
    ...extra,
  });
}

/**
 * Reads a record's version in a snapshot. A deleted record (tombstone) still has a version; only
 * a record that is not stored at all is `absent`.
 *
 * @param snapshot - The snapshot to read.
 * @param target - The record key.
 * @returns The key with its version, or with `absent`.
 */
export function observed(
  snapshot: Snapshot,
  target: RecordKey,
): { readonly key: RecordKey; readonly version: number | 'absent' } {
  const found = findStored(snapshot, target);
  if (!found) return { key: target, version: 'absent' };
  return { key: target, version: found.version };
}

/**
 * Returns a stored record. The test fails immediately when it is not in the snapshot.
 *
 * @param snapshot - The snapshot to read.
 * @param target - The record key.
 * @returns The stored record.
 * @throws AssertionError, showing the key, when the record is not stored.
 */
export function record(
  snapshot: Snapshot,
  target: RecordKey,
): StoredRecord {
  const found = findStored(snapshot, target);
  assert(found, JSON.stringify(target));
  return found;
}

/**
 * Builds a test Authoring on a fresh in-memory SQLite store.
 *
 * Storage, hashing and the Model/Library validation are real. The clock always reads 1000. The
 * resource, feasibility, cancellation and notification roles are scripted to succeed, so a test
 * replaces one of them to make it fail.
 *
 * The store is closed when the test finishes, even when it fails. A test may also close it
 * itself; closing it again then returns a failed result, which is ignored.
 *
 * Call it only inside a test, because it registers that cleanup with Vitest.
 *
 * @param overrides - Collaborators to replace, applied last.
 * @returns The facade, its collaborators and the store.
 * @throws AssertionError when the store cannot be opened.
 */
export function harness(overrides: Partial<Dependencies> = {}): Harness {
  const store = openStore();
  onTestFinished(() => {
    store.close();
  });
  const deps: Dependencies = {
    ...storageRoles(store),
    ...createNodeIdentity(undefined, () => 1000),
    planners: [fixturePlanner],
    validation: domainValidator,
    resources: {
      // Every acquire succeeds with both test assets covered and a release that succeeds.
      acquire: async () => ({
        ok: true,
        value: {
          pins: { theme: 'paper@1' },
          reads: [],
          covered: [media, alternate],
          release: async () => ({ ok: true, value: undefined }),
        },
      }),
    },
    feasibility: {
      // Every candidate is feasible, with no warnings and no preview.
      check: async () => ({ ok: true, value: { warnings: [], diff: [], preview: null } }),
    },
    // Never cancelled, and every notification is delivered.
    cancellation: { cancelled: () => false },
    notifications: { publish: async () => ({ ok: true, value: undefined }) },
    ...overrides,
  };
  return { api: createAuthoring(deps), deps, store };
}

/**
 * Seeds the workspace with collections and their catalog in one request, `seed`.
 *
 * @param h - The harness to seed.
 * @param ids - The collection IDs. Defaults to `['demo']`.
 * @returns The seed's receipt.
 * @throws AssertionError when reading or applying fails.
 * @throws ZodError when a collection ID is not a valid record ID.
 */
export async function seed(
  h: Harness,
  ids: readonly string[] = ['demo'],
): Promise<Receipt> {
  const before = value(await h.api.read(workspace));
  return value(
    await h.api.apply(
      request(before, 'seed', [
        ...ids.map((id) => put('collection', id, diagram(id), [media])),
        put('catalog', 'catalog', catalog(ids)),
      ]),
    ),
  );
}

/**
 * Lists the live collections in a snapshot, leaving out history and deleted collections.
 *
 * @param snapshot - The snapshot to read.
 * @returns The live collection records.
 */
export function liveCollections(snapshot: Snapshot): readonly StoredRecord[] {
  return snapshot.records.filter((item) => item.key.kind === 'collection' && !item.deleted);
}

/** Finds the record stored under a key, or `undefined`. */
function findStored(
  snapshot: Snapshot,
  target: RecordKey,
): StoredRecord | undefined {
  // Kind is compared first, then ID.
  return snapshot.records.find(
    (item) => item.key.kind === target.kind && item.key.id === target.id,
  );
}
