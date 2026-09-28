import { z } from 'zod';
import { workspaceId, requestId, actorId, plannerId, digest } from '../brands.js';
import type { WorkspaceId, RequestId, ActorId, PlannerId, Digest } from '../brands.js';
import type { Json, ReadVersion, RecordKey } from './storage.js';
import { keySchema, versionSchema, jsonSchema } from './storage.js';

/** The most record versions a request may list in `expected`. */
const MAXIMUM_EXPECTED_VERSIONS = 10000;

/** The most record keys a request may list in `scope`. */
const MAXIMUM_SCOPE_KEYS = 1000;

/** The most assets a request may submit. */
const MAXIMUM_SUBMITTED_ASSETS = 10000;

/** The longest asset alias, in characters. */
const MAXIMUM_ALIAS_LENGTH = 128;

/**
 * Checks what a request asks for:
 * - `change`: run the named planner on a data payload.
 * - `undo` or `redo`: act on an earlier original change.
 */
export const intentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('change'), planner: plannerId, payload: jsonSchema }),
  z.strictObject({ kind: z.literal('undo'), transaction: requestId }),
  z.strictObject({ kind: z.literal('redo'), transaction: requestId }),
]);

/**
 * Checks a submitted request. Human editors and language adapters submit the same envelope.
 *
 * - `expected`: the record versions the author saw; every write needs one.
 * - `scope`: the records the request may write.
 * - `assets`: submitted assets, each an alias with the digest of its bytes.
 */
export const requestSchema = z.strictObject({
  workspace: workspaceId,
  request: requestId,
  actor: z.strictObject({ id: actorId, kind: z.enum(['human', 'agent']) }),
  version: z.literal(1),
  expected: z.array(versionSchema).max(MAXIMUM_EXPECTED_VERSIONS),
  scope: z.array(keySchema).max(MAXIMUM_SCOPE_KEYS),
  assets: z
    .array(z.strictObject({ alias: z.string().min(1).max(MAXIMUM_ALIAS_LENGTH), digest }))
    .max(MAXIMUM_SUBMITTED_ASSETS),
  intent: intentSchema,
});

/** Checks apply options. `candidateHash` is the hash `prepare` returned, to reject a changed candidate. */
export const applyOptionsSchema = z.strictObject({ candidateHash: digest.optional() });

/**
 * What a request asks for, written out by hand so it reads clearly without the schema's
 * inferred types.
 */
export type Intent =
  | { readonly kind: 'change'; readonly planner: PlannerId; readonly payload: Json }
  | { readonly kind: 'undo' | 'redo'; readonly transaction: RequestId };

/** A checked submitted request. See `requestSchema`. */
export type Request = {
  readonly workspace: WorkspaceId;
  readonly request: RequestId;
  readonly actor: { readonly id: ActorId; readonly kind: 'human' | 'agent' };
  readonly version: 1;
  readonly expected: readonly ReadVersion[];
  readonly scope: readonly RecordKey[];
  readonly assets: readonly { readonly alias: string; readonly digest: Digest }[];
  readonly intent: Intent;
};

/** Checked apply options. */
export type ApplyOptions = { readonly candidateHash?: Digest };
