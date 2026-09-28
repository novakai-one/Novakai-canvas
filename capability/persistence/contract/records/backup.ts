import { z } from 'zod';
import { digest } from '../brands.js';
import { workspaceState } from './storage.js';
import type { WorkspaceState } from './storage.js';
import type { Digest } from '../brands.js';

/**
 * Largest base64 text for one asset's bytes (32 MiB of text). In practice the base64 regex in
 * {@link blob} throws first; see there.
 */
const MAXIMUM_BLOB_BASE64_LENGTH = 32 * 1024 * 1024;

/**
 * Checks one asset in a bundle: its digest, and its bytes as padded base64 (alphabet, groups of
 * four, `=` padding). Only the encoding is checked here; the injected Assets verifier proves the
 * bytes match the digest and the media policy.
 *
 * Known limit (existing behaviour): the regex overflows the stack and throws `RangeError` for
 * base64 text above roughly 4–8 MiB (Node 24), below the 32 MiB maximum. Callers turn the throw
 * into `corrupt-record` (restore) or `storage-unavailable` (backup).
 */
export const blob = z.strictObject({
  digest,
  base64: z
    .string()
    .max(MAXIMUM_BLOB_BASE64_LENGTH)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}) satisfies z.ZodType<BlobRecord>;

/** Checks the shape of a backup bundle (schema version 1): a workspace state and its assets. */
export const backupBundle = z.strictObject({
  schemaVersion: z.literal(1),
  state: workspaceState,
  blobs: z.array(blob),
}) satisfies z.ZodType<BackupBundle>;

/** One asset's digest and its bytes as base64. */
export interface BlobRecord {
  readonly digest: Digest;
  readonly base64: string;
}

/** A consistent workspace state together with every asset it references, each exactly once. */
export interface BackupBundle {
  readonly schemaVersion: 1;
  readonly state: WorkspaceState;
  readonly blobs: readonly BlobRecord[];
}
