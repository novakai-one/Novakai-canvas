import { z } from 'zod';
import { digest, recordId, requestId, workspaceId } from '../brands.js';
import type { Digest, RecordId, RequestId, WorkspaceId } from '../brands.js';

// Structural storage schemas only. Model and Library validation belongs to Authoring admission.
// Each schema is declared before the schemas built from it.

/** Checks any JSON value. */
export const jsonValue = z.json();

/** A JSON value, deeply read-only. */
export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** Checks a version or sequence number: a whole number from 0 to `Number.MAX_SAFE_INTEGER`. */
export const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** The six storage kinds a record can have. */
const recordKinds = [
  'catalog',
  'collection',
  'asset-admission',
  'preset',
  'history',
  'workspace',
] as const;

/** One of the six storage kinds. */
export type RecordKind = (typeof recordKinds)[number];

/** Checks a record key: one of the six storage kinds and a record ID. */
export const recordKey = z.strictObject({
  kind: z.enum(recordKinds),
  id: recordId,
}) satisfies z.ZodType<RecordKey>;

/** Checks an observed version: a record key and its version, or `'absent'` for no slot. */
export const readVersion = z.strictObject({
  key: recordKey,
  version: z.union([z.literal('absent'), revision]),
}) satisfies z.ZodType<ReadVersion>;

/** Checks one stored slot. The tombstone rules are checked separately, in stored-state validation. */
export const slot = z.strictObject({
  key: recordKey,
  version: revision,
  value: jsonValue,
  deleted: z.boolean(),
  resources: z.array(digest),
}) satisfies z.ZodType<Slot>;

/** Checks one receipt. Its sequence is at least 1, because receipt sequences start at the first commit. */
export const receipt = z.strictObject({
  request: requestId,
  fingerprint: digest,
  sequence: revision.min(1),
  versions: z.array(readVersion),
  outcome: jsonValue,
}) satisfies z.ZodType<Receipt>;

/** Checks the shape of a whole workspace state (schema version 1). */
export const workspaceState = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: workspaceId,
  sequence: revision,
  slots: z.array(slot),
  receipts: z.array(receipt),
}) satisfies z.ZodType<WorkspaceState>;

/** Reads only `schemaVersion`, so an unsupported version is reported before the full shape check. */
export const versionHeader = z.object({ schemaVersion: z.number() });

/**
 * Builds the workspace state schema used when reading stored state.
 *
 * It is {@link workspaceState}, except that each slot `value` and receipt `outcome` must be one of
 * the exact `payloads` values: the values already checked and copied by this read's bounded
 * JSON copy. Object and array payloads must be the same object; primitive payloads match by
 * value. A payload from anywhere else is rejected.
 *
 * @param payloads - The payload values found in this read's copy.
 * @returns The schema for this read.
 */
export function admittedWorkspaceState(payloads: readonly Json[]): z.ZodType<WorkspaceState> {
  const admitted = new Set<unknown>(payloads);
  const payload = z.custom<Json>((value) => admitted.has(value));
  return workspaceState.extend({
    slots: z.array(slot.extend({ value: payload })),
    receipts: z.array(receipt.extend({ outcome: payload })),
  });
}

/** A record's storage identity: its kind and ID. Independent of any diagram-specific record type. */
export interface RecordKey {
  readonly kind: RecordKind;
  readonly id: RecordId;
}

/** A version the author observed for a record: a number, or `'absent'` for no slot. */
export interface ReadVersion {
  readonly key: RecordKey;
  readonly version: number | 'absent';
}

/**
 * One stored version of a record. A tombstone (`deleted: true`) has a `null` value and no
 * resources, and has its own version, one more than the deleted version, so a deleted record
 * cannot be recreated from a stale read.
 */
export interface Slot {
  readonly key: RecordKey;
  readonly version: number;
  readonly value: Json;
  readonly deleted: boolean;
  /** Digests of the asset bytes this version references. */
  readonly resources: readonly Digest[];
}

/** The stored result of one committed request, kept for retry reconciliation. */
export interface Receipt {
  readonly request: RequestId;
  /** Fingerprint of the submitted request; a retry must match it. */
  readonly fingerprint: Digest;
  /** The workspace sequence this commit produced. */
  readonly sequence: number;
  /** The new version of each written record; `'absent'` for a purged one. */
  readonly versions: readonly ReadVersion[];
  /** Authoring's outcome, returned unchanged to a retry. */
  readonly outcome: Json;
}

/** The whole stored state of one workspace. */
export interface WorkspaceState {
  readonly schemaVersion: 1;
  readonly workspace: WorkspaceId;
  /** Number of commits so far; 0 means never committed. */
  readonly sequence: number;
  readonly slots: readonly Slot[];
  /**
   * The kept receipts. Commit keeps them oldest first, at most `RECEIPT_LIMIT`; reading only checks
   * the count is between `min(sequence, RECEIPT_LIMIT)` and `sequence`.
   */
  readonly receipts: readonly Receipt[];
}
