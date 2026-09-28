import { assert } from 'vitest';
import {
  openSqlite,
  type Persistence,
  type Result as StorageResult,
  type ErrorCode as StorageErrorCode,
} from '@novakai/canvas-persistence';
import {
  snapshotSchema,
  receiptSchema,
  failure,
  type SnapshotReader,
  type ReceiptReader,
  type Committer,
  type Result,
  type ErrorCode,
} from '../contract/index.js';

/** The storage roles a test Authoring needs, backed by a Persistence store. */
export interface StorageRoles {
  readonly snapshots: SnapshotReader;
  readonly receipts: ReceiptReader;
  readonly commits: Committer;
}

/**
 * Maps each Persistence error code to an Authoring code. The mapping is explicit; error messages
 * are never parsed. Unknown codes become `storage-unavailable`. `satisfies` makes a new Persistence
 * code a compile error until it is mapped here.
 */
const STORAGE_CODES: Readonly<Record<string, ErrorCode>> = {
  'invalid-input': 'invalid-input',
  'unsupported-version': 'unsupported-version',
  'revision-conflict': 'revision-conflict',
  'request-reused': 'request-reused',
  'storage-unavailable': 'storage-unavailable',
  'corrupt-record': 'corrupt-record',
  'missing-resource': 'missing-asset',
  'destination-not-empty': 'invalid-input',
} satisfies Readonly<Record<StorageErrorCode, ErrorCode>>;

/**
 * Opens a fresh in-memory SQLite store for one test.
 *
 * @returns The open store. The test fails immediately when it cannot be opened.
 */
export function openStore(): Persistence {
  const result = openSqlite(':memory:', 'workspace');
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

/**
 * Builds Authoring's storage roles on top of a Persistence store, the way a host bridge does.
 *
 * Results are checked with the public schemas, which brand the IDs without casts. A storage
 * failure stays a failure; the bridge never turns it into success. A stored value that fails its
 * schema is not returned as a failed `Result`: the role's promise rejects with a ZodError.
 *
 * @param store - The store to read from and commit to.
 * @returns The snapshot reader, receipt reader and committer.
 */
export function storageRoles(
  store: Pick<Persistence, 'readSnapshot' | 'receipt' | 'commit'>,
): StorageRoles {
  return {
    snapshots: {
      read: async () =>
        convert(store.readSnapshot(), (state) =>
          snapshotSchema.parse({
            workspace: state.workspace,
            sequence: state.sequence,
            records: state.slots,
          }),
        ),
    },
    receipts: {
      find: async (_workspace, request) =>
        convert(store.receipt(request), (receipt) =>
          receipt === null ? null : receiptSchema.parse(receipt),
        ),
    },
    commits: {
      commit: async (request) =>
        convert(store.commit(request), (receipt) => receiptSchema.parse(receipt)),
    },
  };
}

/** Maps a Persistence error code to an Authoring code. */
function storageCode(code: string): ErrorCode {
  return STORAGE_CODES[code] ?? 'storage-unavailable';
}

/** Converts a Persistence result: decodes a success, and maps a failure's code, keeping its path and message. */
function convert<T, U>(
  result: StorageResult<T>,
  decode: (input: T) => U,
): Result<U> {
  if (!result.ok) {
    return failure(storageCode(result.error.code), result.error.path, result.error.message);
  }
  return { ok: true, value: decode(result.value) };
}
