/*
 * The record checks candidate validation repeats: a required fact, a required live record and
 * exact byte retention, and the one refusal they share. Pure; every check answers Authoring's
 * `invariant-violation` at `candidate` as a value, and the first failure stops validation.
 * Authoring keeps the committed snapshot on rejection.
 */
import type {
  AuthoringResult,
  Snapshot,
  StoredRecord,
} from '../../../contract/records/capability-types.js';
import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import { andThen, authoringFailure, collect, success } from '../../../contract/errors.js';
import { findLiveRecord, type RecordKind } from '../../workspace/records.js';

/**
 * The refusal of a candidate that breaks an ownership invariant: `invariant-violation` at
 * `candidate` with this message, and the owner's failure in `source` when an owner refused.
 */
export function invariantBroken(
  message: string,
  source?: FailureSource,
): AuthoringResult<never> {
  return authoringFailure('invariant-violation', 'candidate', message, [], source);
}

/** Passes when the condition holds. Fails with `invariant-violation` at `candidate` otherwise. */
export function requireFact(
  condition: boolean,
  message: string,
): AuthoringResult<void> {
  if (!condition) return invariantBroken(message);
  return success(undefined);
}

/**
 * The live record with this kind and ID. Fails with `invariant-violation` at `candidate`
 * ("Missing canonical record <kind>:<id>") when there is none.
 */
export function requireRecord(
  snapshot: Snapshot,
  kind: RecordKind,
  id: string,
): AuthoringResult<StoredRecord> {
  const value = findLiveRecord(snapshot, kind, id);
  if (!value) return invariantBroken(`Missing canonical record ${kind}:${id}`);
  return success(value);
}

/**
 * Passes when the record retains exactly the expected digests; order and repeated expected
 * digests are ignored. Fails with `invariant-violation` at `candidate` ("Resource retention
 * differs for <kind>:<id>") otherwise.
 */
export function requireRetention(
  record: StoredRecord,
  expected: readonly string[],
): AuthoringResult<void> {
  return requireFact(
    retainsExactly(record, expected),
    `Resource retention differs for ${record.key.kind}:${record.key.id}`,
  );
}

/**
 * Runs `check` on each item in order; passes when every check passed. The first failure is
 * returned unchanged and later items are not checked.
 */
export function allPassed<I>(
  items: readonly I[],
  check: (item: I) => AuthoringResult<void>,
): AuthoringResult<void> {
  return andThen(collect(items, check), () => success(undefined));
}

/**
 * Whether the record's retained digests, sorted, equal the distinct expected digests, sorted. A
 * digest the record retains twice makes them differ.
 */
function retainsExactly(
  record: StoredRecord,
  expected: readonly string[],
): boolean {
  const retained = [...record.resources].toSorted();
  const wanted = [...new Set(expected)].toSorted();
  return (
    retained.length === wanted.length && retained.every((digest, index) => digest === wanted[index])
  );
}
