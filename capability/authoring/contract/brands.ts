import { z } from 'zod';

/**
 * A storage-compatible identifier: 1 to 128 characters, starting with a letter or digit, then
 * letters, digits, `_`, `.`, `:` or `-`.
 */
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);

/** Checks and brands a workspace ID. */
export const workspaceId = identifier.brand<'AuthoringWorkspaceId'>();

/** Checks and brands a record ID. */
export const recordId = identifier.brand<'AuthoringRecordId'>();

/**
 * Checks and brands a request ID. It is at most 120 characters, leaving room for the `tx:` and
 * `head:` prefixes of the history record IDs generated from it.
 */
export const requestId = identifier.max(120).brand<'AuthoringRequestId'>();

/** Checks and brands the ID of a human or agent that submits requests. */
export const actorId = identifier.brand<'ActorId'>();

/** Checks and brands the ID of a registered intent planner. */
export const plannerId = identifier.brand<'PlannerId'>();

/** Checks and brands a digest: 64 lowercase hexadecimal characters. */
export const digest = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<'AuthoringDigest'>();

/** Checks and brands a timestamp: a whole, non-negative number of milliseconds. */
export const timestamp = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .brand<'Timestamp'>();

/** A checked workspace ID. */
export type WorkspaceId = z.infer<typeof workspaceId>;

/** A checked record ID. */
export type RecordId = z.infer<typeof recordId>;

/** A checked request ID. */
export type RequestId = z.infer<typeof requestId>;

/** A checked actor ID. */
export type ActorId = z.infer<typeof actorId>;

/** A checked planner ID. */
export type PlannerId = z.infer<typeof plannerId>;

/** A checked digest. */
export type Digest = z.infer<typeof digest>;

/** A checked timestamp. */
export type Timestamp = z.infer<typeof timestamp>;
