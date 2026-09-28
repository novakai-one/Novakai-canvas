import { expect } from 'vitest';
import { workspaceId, recordId, requestId, digest } from '../contract/index.js';
import type {
  Result,
  CommitRequest,
  RecordKey,
  WorkspaceState,
  ErrorCode,
} from '../contract/index.js';

/** The workspace every test uses. */
export const workspace = workspaceId.parse('workspace');

/** A collection record key. */
export const collection: RecordKey = { kind: 'collection', id: recordId.parse('diagram') };

/** A history record key. */
export const history: RecordKey = { kind: 'history', id: recordId.parse('transaction') };

/** SHA-256 of the three bytes `abc`. */
export const abcDigest = digest.parse(
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
);

/**
 * Asserts a result succeeded and returns its value. A failure fails the test (never a silent
 * default).
 *
 * @throws Vitest's `AssertionError` for a failed result. The `Error` after it is never reached;
 * it only narrows the type.
 */
export function value<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/**
 * Asserts a result failed with `code`. The message wording is not checked.
 *
 * @param result - The result to check.
 * @param code - The expected failure code.
 * @throws Vitest's assertion error when the result succeeded or has another code.
 */
export function rejects(
  result: Result<unknown>,
  code: ErrorCode,
): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

/**
 * A new empty workspace state (never committed). Also used as raw stored state in driver-level
 * tests.
 *
 * @returns A fresh state at sequence 0 with no slots or receipts.
 */
export function pristine(): WorkspaceState {
  return { schemaVersion: 1, workspace, sequence: 0, slots: [], receipts: [] };
}

/**
 * A request that creates one collection: it expects the collection to be absent and has a fixed
 * fingerprint, so a repeat is a valid retry.
 *
 * @param id - The request ID. Defaults to `request-one`.
 */
export function request(id = 'request-one'): CommitRequest {
  return {
    workspace,
    request: requestId.parse(id),
    fingerprint: digest.parse('a'.repeat(64)),
    expected: [{ key: collection, version: 'absent' }],
    writes: [{ kind: 'put', key: collection, value: { title: 'Diagram' }, resources: [] }],
    outcome: { status: 'applied' },
  };
}
