import { z } from 'zod';

/**
 * The shared grammar for storage IDs: 1–128 characters of letters, digits and `_ . : -`,
 * starting with a letter or digit. A slash is never allowed, which keeps `kind/id` keys
 * unambiguous. Declared first because the branded schemas below are built from it.
 */
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);

/**
 * Checks a workspace ID. One database belongs to exactly one workspace. Persistence checks the
 * format only; Authoring allocates semantic identities and owns retry recovery.
 */
export const workspaceId = identifier.brand<'WorkspaceId'>();

/** Checks a record ID, the `id` half of a record key. */
export const recordId = identifier.brand<'RecordId'>();

/** Checks a request ID, which identifies one submitted change and its receipt. */
export const requestId = identifier.brand<'RequestId'>();

/** Checks a SHA-256 digest: 64 lowercase hex characters. Used for asset bytes and fingerprints. */
export const digest = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<'Digest'>();

/** A workspace ID that passed {@link workspaceId}. */
export type WorkspaceId = z.infer<typeof workspaceId>;

/** A record ID that passed {@link recordId}. */
export type RecordId = z.infer<typeof recordId>;

/** A request ID that passed {@link requestId}. */
export type RequestId = z.infer<typeof requestId>;

/** A digest that passed {@link digest}. */
export type Digest = z.infer<typeof digest>;
