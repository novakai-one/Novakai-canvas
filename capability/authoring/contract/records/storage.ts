import { z } from 'zod';
import { workspaceId, recordId, requestId, digest } from '../brands.js';
import { diagnosticSchema } from '../errors.js';
import type { Digest, WorkspaceId, RequestId } from '../brands.js';
import type { Diagnostic } from '../errors.js';

/**
 * Plain JSON data. Authoring's boundary checks reject getters, cycles, class instances and
 * non-finite numbers before anything becomes `Json`.
 */
export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** Checks a JSON value. */
export const jsonSchema = z.json();

/** Checks a storage version or a workspace `sequence`: a whole number from 0 up to the largest safe integer. */
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Checks a record key: a record kind and an ID. */
export const keySchema = z.strictObject({
  kind: z.enum(['collection', 'catalog', 'asset-admission', 'preset', 'workspace', 'history']),
  id: recordId,
});

/**
 * Checks an observed record version. `absent` means no record is stored under the key: it was
 * never stored, or it was a purged history record.
 */
export const versionSchema = z.strictObject({
  key: keySchema,
  version: z.union([z.literal('absent'), revisionSchema]),
});

/**
 * Checks a stored record. A deleted record (tombstone) stays stored under a new version, with
 * `deleted: true`, a `null` value and no resources.
 */
export const storedSchema = z.strictObject({
  key: keySchema,
  version: revisionSchema,
  value: jsonSchema,
  deleted: z.boolean(),
  resources: z.array(digest),
});

/** Checks a workspace snapshot. `sequence` counts the workspace's commits. */
export const snapshotSchema = z.strictObject({
  workspace: workspaceId,
  sequence: revisionSchema,
  records: z.array(storedSchema),
});

/** Checks a write: a `put` of a value with its resources, or a `delete`. */
export const writeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('put'),
    key: keySchema,
    value: jsonSchema,
    resources: z.array(digest),
  }),
  z.strictObject({ kind: z.literal('delete'), key: keySchema }),
]);

/** Checks a commit outcome. See `CommitOutcome`. */
export const outcomeSchema = z.strictObject({
  status: z.enum(['committed', 'no-op']),
  transaction: requestId.nullable(),
  pins: jsonSchema,
  diff: jsonSchema,
  warnings: z.array(diagnosticSchema),
});

/** Checks a receipt. See `Receipt`. */
export const receiptSchema = z.strictObject({
  request: requestId,
  fingerprint: digest,
  sequence: revisionSchema.min(1),
  versions: z.array(versionSchema),
  outcome: outcomeSchema,
});

/** Identifies one stored record: its kind and ID. */
export type RecordKey = {
  readonly kind: z.infer<typeof keySchema>['kind'];
  readonly id: z.infer<typeof keySchema>['id'];
};

/**
 * A record key with the version it was observed at, or `absent` when no record is stored under
 * the key (never stored, or a purged history record).
 */
export type ReadVersion = { readonly key: RecordKey; readonly version: number | 'absent' };

/** One stored record. A deleted record has `deleted: true`, a `null` value and no resources. */
export interface StoredRecord {
  readonly key: RecordKey;
  readonly version: number;
  readonly value: Json;
  readonly deleted: boolean;
  readonly resources: readonly Digest[];
}

/** One consistent view of a workspace's records. */
export interface Snapshot {
  readonly workspace: WorkspaceId;
  /** The number of commits so far. */
  readonly sequence: number;
  readonly records: readonly StoredRecord[];
}

/** A change to one record: store a value with its resources, or delete it. */
export type Write =
  | {
      readonly kind: 'put';
      readonly key: RecordKey;
      readonly value: Json;
      readonly resources: readonly Digest[];
    }
  | { readonly kind: 'delete'; readonly key: RecordKey };

/** What a commit did, stored in its receipt. */
export interface CommitOutcome {
  /** `no-op` when the request changed nothing. */
  readonly status: 'committed' | 'no-op';
  /** The history transaction written, or `null` for a no-op or a history-only commit. */
  readonly transaction: RequestId | null;
  /** The resource pins used. */
  readonly pins: Json;
  /** A description of the change. */
  readonly diff: Json;
  /** Warnings that did not stop the change. */
  readonly warnings: readonly Diagnostic[];
}

/** The durable proof that a request committed. A retry of the same request returns it unchanged. */
export interface Receipt {
  readonly request: RequestId;
  /** The fingerprint of the submitted request, used to detect a request ID reused for different intent. */
  readonly fingerprint: Digest;
  /** The workspace sequence after the commit. */
  readonly sequence: number;
  /** The versions of the records the commit wrote. Purged records are listed as `absent`. */
  readonly versions: readonly ReadVersion[];
  readonly outcome: CommitOutcome;
}
