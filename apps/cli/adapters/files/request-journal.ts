/*
 * The retained-request journal: one JSON file per request ID under the workspace `requests`
 * directory, created exclusively and fsynced before anything is sent. Filesystem I/O; each failure
 * is returned as a value. The journal is the CLI's recovery record for `receipt` then `retry`.
 */
import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requestSchema, requestId } from '@novakai/canvas-authoring';
import { byteBackup } from '../../contract/records/resources.js';
import { z } from 'zod';
import type { RequestFiles, RequestDraft } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/** One journal file: the generation it was sent under, the Authoring request and its byte backups. */
const retained = z.strictObject({
  generation: z.string(),
  request: requestSchema,
  backups: z.array(byteBackup).optional(),
});
/** Bind one local request directory; each operation reports its own I/O failure and recovery. */
export function createRequestJournal(root: string): Pick<RequestFiles, 'save' | 'read'> {
  return { save: (draft) => save(root, draft), read: (id) => read(root, id) };
}
/** Request IDs are owner-validated before they are used as filenames, excluding path separators and traversal. */
function location(
  root: string,
  id: string,
): Result<string> {
  const checked = requestId.safeParse(id);
  if (!checked.success) return failure('invalid-request', 'Request ID is invalid');
  return { ok: true, value: resolve(root, `${checked.data}.json`) };
}
/** Existing records may update only their transport generation; the canonical Authoring envelope must be byte-equivalent. */
async function existing(
  path: string,
  draft: RequestDraft,
): Promise<Result<void>> {
  const old = retained.parse(JSON.parse(await readFile(path, 'utf8')));
  if (JSON.stringify(old.request) !== JSON.stringify(draft.request))
    return failure('request-reused', 'This request ID is already retained for different authoring');
  return { ok: true, value: undefined };
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
    return { ok: true, value: undefined };
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
    const path = location(root, draft.request.request);
    if (!path.ok) return path;
    await mkdir(root, { recursive: true, mode: 0o700 });
    return await persist(path.value, draft);
  } catch {
    return failure(
      'retention-unavailable',
      'Cannot retain the request safely; no submission was made',
    );
  }
}
/** Retained JSON is host data, never agent-authored syntax; it is checked again before replay. */
async function read(
  root: string,
  id: string,
): Promise<Result<RequestDraft>> {
  try {
    const path = location(root, id);
    if (!path.ok) return path;
    return { ok: true, value: retained.parse(JSON.parse(await readFile(path.value, 'utf8'))) };
  } catch {
    return failure(
      'request-unavailable',
      'Retained request could not be read; inspect its receipt before submitting another',
    );
  }
}
