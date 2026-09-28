/*
 * The retained request: what the request journal keeps so `receipt` then `retry` can recover a
 * write. Declarations and the journal file schema; pure. Core builds and sends it; the journal
 * adapter writes it and decodes it with `journalFile`.
 */
import { z } from 'zod';
import { assetDigest, type Generation } from '../brands.js';
import { requestSchema } from '../schemas.js';
import type { Request } from './foreign.js';

/** Checks one byte backup, as the journal stores it and as Assets' blob answer is reduced to. */
export const byteBackup = z.strictObject({ digest: assetDigest, base64: z.string() });

/** The exact normalized bytes Assets holds for one digest. Local replay data, never a workspace record. */
export type ByteBackup = Readonly<z.infer<typeof byteBackup>>;

/**
 * A request as the journal returns it: the Authoring request and its byte backups (`[]` when
 * none). The generation it was first sent under is not returned: a replay is always sent under
 * the service's current generation.
 */
export interface JournalRecord {
  readonly request: Request;
  readonly backups: readonly ByteBackup[];
}

/** A request ready to retain and send: a journal record and the service generation it goes under. */
export interface RetainedRequest extends JournalRecord {
  readonly generation: Generation;
}

/**
 * Checks one journal file. A file written before backups were always retained has no `backups`
 * key; it reads as `[]`. The generation is checked only to be text: a journal read does not
 * return it (see {@link JournalRecord}).
 */
export const journalFile = z.strictObject({
  generation: z.string(),
  request: requestSchema,
  backups: z.array(byteBackup).readonly().default([]),
});
