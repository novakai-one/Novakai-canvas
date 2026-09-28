/*
 * Why this file exists
 *
 * A change can be sent and its answer lost, for example when the connection drops. The agent then
 * runs `canvas receipt ID` to see whether it was saved, and `canvas retry ID` to send the very
 * same request again. That only works if the CLI wrote the request down before sending it.
 *
 * This file names what the CLI writes to its request journal (a folder in the workspace) for each
 * request: the request, and copies of any font or image bytes it needs. It also checks a journal
 * file when it is read back. It never touches a file itself; `adapters/files/` does.
 */
import { z } from 'zod';
import { assetDigest, type ServiceGeneration } from '../brands.js';
import { requestSchema } from '../schemas.js';
import type { AuthoringRequest } from './foreign.js';

/** Checks one copy of a font or image in the journal: its digest, and its bytes as base64 text. */
export const byteBackupSchema = z.strictObject({ digest: assetDigest, base64: z.string() });

/**
 * A copy of the exact bytes Assets holds for one font or image, so a retry can put them back. It
 * is written only to the request journal, never saved as a record.
 */
export type ByteBackup = Readonly<z.infer<typeof byteBackupSchema>>;

/** A journal entry as read back: the Authoring request and its byte copies (`[]` when none). */
export interface JournalRecord {
  readonly request: AuthoringRequest;
  readonly backups: readonly ByteBackup[];
}

/**
 * A request ready to write to the journal and send: the entry, plus the service generation (the
 * label of one service start; see `brands.ts`) it is sent under.
 */
export interface RetainedRequest extends JournalRecord {
  readonly generation: ServiceGeneration;
}

/**
 * Checks one journal file; an old file with no `backups` reads as `[]`. The generation it was first
 * sent under is only checked to be text, since a retry always uses the current one.
 */
export const journalFileSchema = z.strictObject({
  generation: z.string(),
  request: requestSchema,
  backups: z.array(byteBackupSchema).readonly().default([]),
});
