import { z } from 'zod';
import { digest, requestId, workspaceId } from '../brands.js';
import { jsonValue, readVersion, recordKey } from './storage.js';
import type { Json, RecordKey, ReadVersion } from './storage.js';
import type { Digest, WorkspaceId, RequestId } from '../brands.js';

/**
 * Checks one write. Authoring computes the payloads and history records; Persistence stores them.
 * - `put`: store a new version with this value and these asset digests.
 * - `delete`: store a tombstone version.
 * - `purge`: remove the slot and its version token entirely. Only for records that are never
 *   recreated.
 */
export const write = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('put'),
    key: recordKey,
    value: jsonValue,
    resources: z.array(digest),
  }),
  z.strictObject({ kind: z.literal('delete'), key: recordKey }),
  z.strictObject({ kind: z.literal('purge'), key: recordKey }),
]) satisfies z.ZodType<Write>;

/**
 * Checks the shape of a commit request. The rules across fields (no duplicate keys, one observed
 * version per write, no repeated asset digest within one put) are checked by request validation.
 */
export const commitRequest = z.strictObject({
  workspace: workspaceId,
  request: requestId,
  fingerprint: digest,
  expected: z.array(readVersion),
  writes: z.array(write),
  outcome: jsonValue,
}) satisfies z.ZodType<CommitRequest>;

/** One change to one record. See {@link write} for what each kind does. */
export type Write =
  | {
      readonly kind: 'put';
      readonly key: RecordKey;
      readonly value: Json;
      readonly resources: readonly Digest[];
    }
  | { readonly kind: 'delete' | 'purge'; readonly key: RecordKey };

/** One atomic change to a workspace, as submitted by Authoring. */
export interface CommitRequest {
  readonly workspace: WorkspaceId;
  /** Identifies this change; a retry reuses it. */
  readonly request: RequestId;
  /** Fingerprint of the submitted change, computed by Authoring. */
  readonly fingerprint: Digest;
  /** Every record version the change depends on, including each written record's. */
  readonly expected: readonly ReadVersion[];
  readonly writes: readonly Write[];
  /** Authoring's outcome, stored in the receipt and returned to retries. */
  readonly outcome: Json;
}
