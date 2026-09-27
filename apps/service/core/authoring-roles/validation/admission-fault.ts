/*
 * The private fault that stops candidate validation, and the three checks that raise it: a
 * required fact, a required live record and exact byte retention. Pure; each check throws
 * `AdmissionFault`, which only `validate` (candidate.ts) catches and answers as Authoring's
 * `invariant-violation`. Authoring keeps the committed snapshot on rejection.
 */
import type { Snapshot, StoredRecord } from '../../../contract/records/capabilities.js';
import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import { liveRecord, type RecordKind } from '../../workspace/records.js';

/**
 * The private fault that stops the checks: a message and, for an owner's failure, its source.
 * Only `rejected` (candidate.ts) reads it; it never leaves `validate`.
 */
export class AdmissionFault extends Error {
  /** A fault with this message; `source` is the owner's failure when an owner refused. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}

/** Throws `AdmissionFault` with this message when the condition is false. */
export function requireFact(
  condition: boolean,
  message: string,
): void {
  if (!condition) throw new AdmissionFault(message);
}

/** The live record with this kind and ID. Throws `AdmissionFault` when there is none. */
export function requireRecord(
  snapshot: Snapshot,
  kind: RecordKind,
  id: string,
): StoredRecord {
  const value = liveRecord(snapshot, kind, id);
  if (!value) throw new AdmissionFault(`Missing canonical record ${kind}:${id}`);
  return value;
}

/**
 * Throws `AdmissionFault` unless the record retains exactly the expected digests. Order and
 * repeated expected digests are ignored.
 */
export function requireRetention(
  record: StoredRecord,
  expected: readonly string[],
): void {
  requireFact(
    JSON.stringify([...record.resources].toSorted()) ===
      JSON.stringify([...new Set(expected)].toSorted()),
    `Resource retention differs for ${record.key.kind}:${record.key.id}`,
  );
}
