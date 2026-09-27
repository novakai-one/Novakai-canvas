import { readFile, mkdir, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requestSchema, requestId } from '@novakai/canvas-authoring';
import { byteBackup } from '../../contract/records/resources.js';
import { z } from 'zod';
import type { RequestFiles, RequestDraft } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
const retained = z.strictObject({
  generation: z.string(),
  request: requestSchema,
  backups: z.array(byteBackup).optional(),
});
/** A bounded UTF-8 file is decoded strictly; unreadable inputs fail before any service request. */
async function source(path: string): Promise<Result<string>> {
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > 16 * 1024 * 1024)
      return failure('source-too-large', 'DSL source exceeds 16 MiB');
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return failure('source-unavailable', `Cannot read UTF-8 source: ${path}`);
  }
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
/** --out is an explicit destination. Writing source output never changes canonical service data. */
async function output(
  path: string,
  text: string,
): Promise<Result<void>> {
  try {
    await writeFile(path, text, 'utf8');
    return { ok: true, value: undefined };
  } catch {
    return failure('output-unavailable', `Cannot write output: ${path}`);
  }
}
/** Bind one local request directory; each operation reports its own I/O failure and recovery. */
export function createRequestFiles(root: string): RequestFiles {
  return { source, save: (draft) => save(root, draft), read: (id) => read(root, id), output };
}
