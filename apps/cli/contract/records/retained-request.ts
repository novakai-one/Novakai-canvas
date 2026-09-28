/*
 * Why this file exists
 *
 * A change can be sent and its answer lost, for example when the connection drops. The agent then
 * runs `canvas receipt ID` to see whether it was saved, and `canvas retry ID` to send the very
 * same request again. That only works if the CLI kept the request before sending it.
 *
 * This file names what the CLI keeps for each request in its request journal (a folder in the
 * workspace): the request, and copies of any font or image bytes it needs. It also checks a kept
 * file when it is read back. It never touches a file itself; `adapters/files/` does.
 */
import { z } from 'zod';
import { assetDigest, type Generation } from '../brands.js';
import { requestSchema } from '../schemas.js';
import type { Request } from './foreign.js';

/** Checks one kept copy of a font or image: its digest, and its bytes as base64 text. */
export const byteBackup = z.strictObject({ digest: assetDigest, base64: z.string() });

/**
 * A kept copy of the exact bytes Assets holds for one font or image, so a retry can put them back.
 * It is kept only in the request journal, never as a saved record.
 */
export type ByteBackup = Readonly<z.infer<typeof byteBackup>>;

/**
 * A kept request as read back: the Authoring request and its byte copies (`[]` when none). The
 * service generation isn't read back, because a retry always goes under the current one.
 */
export interface JournalRecord {
  readonly request: Request;
  readonly backups: readonly ByteBackup[];
}

/** A request ready to keep and send: the request, its byte copies, and the service generation. */
export interface RetainedRequest extends JournalRecord {
  readonly generation: Generation;
}

/**
 * Checks one kept request file. A file from before byte copies were always kept has no `backups`,
 * and reads as `[]`. The generation is only checked to be text, since it isn't read back.
 */
export const journalFile = z.strictObject({
  generation: z.string(),
  request: requestSchema,
  backups: z.array(byteBackup).readonly().default([]),
});
