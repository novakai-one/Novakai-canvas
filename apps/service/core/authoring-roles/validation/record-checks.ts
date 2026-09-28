/*
 * Why this file exists
 *
 * The final check (candidate.ts) asks the same few questions of many records. Is this record
 * there? Is this fact true? Does the record keep exactly the stored files it should? For example,
 * the catalog record must exist and keep no files at all.
 *
 * This file holds those small checks. Each answers Authoring's `Result` (contract/errors.ts), and
 * every mistake is `invariant-violation` at `candidate`. They only read.
 */
import type {
  AuthoringResult,
  Snapshot,
  StoredRecord,
} from '../../../contract/records/capability-types.js';
import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import { authoringFailure, collect, success } from '../../../contract/errors.js';
import { findLiveRecord, type RecordKind } from '../../workspace/records.js';

/**
 * Makes the one kind of mistake the final check answers: `invariant-violation` at `candidate`,
 * saying `message`. `source` keeps a capability's own mistake when one caused it.
 */
export function invariantViolationFailure(
  message: string,
  source?: FailureSource,
): AuthoringResult<never> {
  return authoringFailure('invariant-violation', 'candidate', message, [], source);
}

/** Passes when `condition` is true. Otherwise answers the mistake, saying `message`. */
export function requireFact(
  condition: boolean,
  message: string,
): AuthoringResult<void> {
  if (!condition) {
    return invariantViolationFailure(message);
  }
  return success(undefined);
}

/**
 * Finds the live record with this kind and ID (`id` is the record ID as plain text). When there is
 * none, the mistake says "Missing canonical record <kind>:<id>".
 */
export function requireRecord(
  snapshot: Snapshot,
  kind: RecordKind,
  id: string,
): AuthoringResult<StoredRecord> {
  const record = findLiveRecord(snapshot, kind, id);
  if (record === undefined) {
    return missingRecordFailure(kind, id);
  }
  return success(record);
}

/**
 * Passes when the record keeps exactly these stored files, named by their digests (plain text).
 * Order and repeats in `expectedDigests` don't matter. Otherwise the mistake says "Resource
 * retention differs for <kind>:<id>".
 */
export function requireExactFiles(
  record: StoredRecord,
  expectedDigests: readonly string[],
): AuthoringResult<void> {
  if (!retainsExactly(record, expectedDigests)) {
    return retentionDiffersFailure(record);
  }
  return success(undefined);
}

/**
 * Runs `check` on each item, in order, and passes when every one passes. It stops at the first
 * mistake and answers it unchanged; later items aren't checked.
 */
export function checkEach<Item>(
  items: readonly Item[],
  check: (item: Item) => AuthoringResult<void>,
): AuthoringResult<void> {
  const checked = collect(items, check);
  if (!checked.ok) {
    return checked;
  }
  return success(undefined);
}

/** Whether the record keeps each expected file once, and no other; a file kept twice fails. */
function retainsExactly(
  record: StoredRecord,
  expectedDigests: readonly string[],
): boolean {
  const retained = record.resources.toSorted();
  const distinctExpected = [...new Set(expectedDigests)];
  const wanted = distinctExpected.toSorted();
  return sameSortedDigests(retained, wanted);
}

/** Whether two sorted digest lists hold the same digests. */
function sameSortedDigests(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((digest, index) => digest === right[index]);
}

/** Makes the mistake for a record that isn't in the candidate. */
function missingRecordFailure(
  kind: RecordKind,
  id: string,
): AuthoringResult<never> {
  return invariantViolationFailure(`Missing canonical record ${kind}:${id}`);
}

/** Makes the mistake for a record that doesn't keep exactly the stored files it should. */
function retentionDiffersFailure(record: StoredRecord): AuthoringResult<never> {
  return invariantViolationFailure(
    `Resource retention differs for ${record.key.kind}:${record.key.id}`,
  );
}
