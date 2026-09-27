/*
 * The retained-request journal: one JSON file per request ID under the workspace `requests`
 * directory, created exclusively and fsynced before anything is sent. Filesystem I/O; each failure
 * is returned as a value. The journal is the CLI's recovery record for `receipt` then `retry`.
 */
import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { requestSchema } from '../../contract/schemas.js';
import type { RequestId } from '../../contract/brands.js';
import { byteBackup } from '../../contract/records/resources.js';
import type { JournalRecord, RequestFiles, RequestDraft } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * One journal file: the generation it was sent under, the Authoring request and its byte backups.
 * A file written before backups were always retained has no `backups` key; it reads as `[]`. The
 * generation is only checked to be text: nothing reads it back (see {@link JournalRecord}).
 */
const retained = z.strictObject({
  generation: z.string(),
  request: requestSchema,
  backups: z.array(byteBackup).readonly().default([]),
});
/** Bind one local request directory; each operation reports its own I/O failure and recovery. */
export function createRequestJournal(root: string): Pick<RequestFiles, 'save' | 'read'> {
  return { save: (draft) => save(root, draft), read: (id) => read(root, id) };
}
/** A request's journal file. Authoring's request ID grammar has no path separator or leading dot. */
function location(
  root: string,
  id: RequestId,
): string {
  return resolve(root, `${id}.json`);
}
/** Existing records may update only their transport generation; the canonical Authoring envelope must be byte-equivalent. */
async function existing(
  path: string,
  draft: RequestDraft,
): Promise<Result<void>> {
  const old = retained.parse(JSON.parse(await readFile(path, 'utf8')));
  if (JSON.stringify(old.request) !== JSON.stringify(draft.request))
    return failure({
      code: 'request-reused',
      message: 'This request ID is already retained for different authoring',
    });
  return success(undefined);
}
/** Exclusive creation plus fsync retains the immutable Authoring request before any possible commit. */
async function persist(
  path: string,
  draft: RequestDraft,
): Promise<Result<void>> {
  const file = await open(path, 'wx', 0o600).catch(() => null);
  if (file === null) return existing(path, draft);
  try {
    await file.writeFile(JSON.stringify(draft));
    await file.sync();
    return success(undefined);
  } finally {
    await file.close();
  }
}
/** Failed retention prevents submission; the user fixes the local directory before retrying. */
async function save(
  root: string,
  draft: RequestDraft,
): Promise<Result<void>> {
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    return await persist(location(root, draft.request.request), draft);
  } catch {
    return failure({
      code: 'retention-unavailable',
      message: 'Cannot retain the request safely; no submission was made',
    });
  }
}
/**
 * Retained JSON is host data, never agent-authored syntax; it is checked again before replay.
 * Fails with `request-unavailable` (missing, unreadable or not a journal file).
 */
async function read(
  root: string,
  id: RequestId,
): Promise<Result<JournalRecord>> {
  try {
    const file = retained.parse(JSON.parse(await readFile(location(root, id), 'utf8')));
    return success({ request: file.request, backups: file.backups });
  } catch {
    return failure({
      code: 'request-unavailable',
      message: 'Retained request could not be read; inspect its receipt before submitting another',
    });
  }
}
