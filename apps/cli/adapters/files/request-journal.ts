/*
 * The retained-request journal: one JSON file per request ID under the workspace `requests`
 * directory, created exclusively and fsynced before the Authoring request is sent. Filesystem I/O;
 * each failure is returned as a value. The journal is the CLI's recovery record for `receipt` then
 * `retry`. A file that cannot be read keeps its I/O code; a file that reads but is not a journal
 * record, or holds another request's record, is `journal-corrupt`, and its request's receipt is
 * checked before authoring again.
 */
import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FilePath, RequestId } from '../../contract/brands.js';
import { journalFileSchema } from '../../contract/records/retained-request.js';
import type { JournalRecord, RetainedRequest } from '../../contract/records/retained-request.js';
import type { RequestJournal } from '../../contract/ports/request-journal.js';
import type { FailureInput, LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** `retention-unavailable`: the directory or file cannot be used. No Authoring request is sent. */
const notRetained: FailureInput = Object.freeze({
  code: 'retention-unavailable',
  message: 'Cannot retain the request safely; no submission was made',
});

/** `request-unavailable`: the request's file is missing or cannot be read. */
const unavailable: FailureInput = Object.freeze({
  code: 'request-unavailable',
  message: 'Retained request could not be read; inspect its receipt before submitting another',
});

/**
 * Binds the `requests` directory of `workspace`; each operation reports its own I/O failure and
 * recovery.
 */
export function createRequestJournal(workspace: FilePath): RequestJournal {
  const root = resolve(workspace, 'requests');
  return { save: (retained) => save(root, retained), read: (id) => read(root, id) };
}
/**
 * Failed retention prevents submission; the user fixes the local directory before retrying.
 * Fails with `retention-unavailable` (the directory or file cannot be created, written or read
 * back), `journal-corrupt` (the ID's existing file is not a journal record, or holds another ID's)
 * or `request-reused`.
 */
async function save(
  root: string,
  retained: RetainedRequest,
): Promise<Result<void, LocalFailure>> {
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    return await persist(location(root, retained.request.request), retained);
  } catch {
    return failure(notRetained);
  }
}
/** Exclusive creation plus fsync retains the immutable Authoring request before any possible commit. */
async function persist(
  path: string,
  retained: RetainedRequest,
): Promise<Result<void, LocalFailure>> {
  const file = await open(path, 'wx', 0o600).catch(() => null);
  if (file === null) return existing(path, retained);
  try {
    await file.writeFile(JSON.stringify(retained));
    await file.sync();
    return success(undefined);
  } finally {
    await file.close();
  }
}
/**
 * Saving an ID again succeeds only for the same Authoring request: the request parsed from the
 * file must serialise exactly as `retained`'s. The generation may differ; the file is not
 * rewritten. Fails with `retention-unavailable` (the file cannot be read), `journal-corrupt` or
 * `request-reused`.
 */
async function existing(
  path: string,
  retained: RetainedRequest,
): Promise<Result<void, LocalFailure>> {
  const old = await load(path, retained.request.request, notRetained);
  if (!old.ok) return old;
  if (JSON.stringify(old.value.request) !== JSON.stringify(retained.request))
    return failure({
      code: 'request-reused',
      message: 'This request ID is already retained for different authoring',
    });
  return success(undefined);
}
/**
 * The retained request and its byte backups; a file without `backups` reads as `[]`. Fails with
 * `request-unavailable` (missing or unreadable) or `journal-corrupt` (not a journal record, or
 * another ID's).
 */
function read(
  root: string,
  id: RequestId,
): Promise<Result<JournalRecord, LocalFailure>> {
  return load(location(root, id), id, unavailable);
}
/**
 * The journal record in `path`, `id`'s file. Retained JSON is host data, never agent-authored
 * syntax; it is checked on every read. Fails with `unreadable` when the file cannot be read, or as
 * `decode` does.
 */
async function load(
  path: string,
  id: RequestId,
  unreadable: FailureInput,
): Promise<Result<JournalRecord, LocalFailure>> {
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null) return failure(unreadable);
  return decode(text, path, id);
}
/**
 * The journal record `text` holds for request `id`. Fails with `journal-corrupt` when the text is
 * not JSON, not a journal record, or another request's record (a file copied or renamed to `id`).
 */
function decode(
  text: string,
  path: string,
  id: RequestId,
): Result<JournalRecord, LocalFailure> {
  const file = journalFileSchema.safeParse(jsonValue(text));
  if (!file.success) return failure(corrupt(path, id));
  if (file.data.request.request !== id) return failure(corrupt(path, id));
  return success({ request: file.data.request, backups: file.data.backups });
}
/** The value JSON `text` holds. Text that is not JSON reads as `undefined`, which no journal file matches. */
function jsonValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
/** A request's journal file. Authoring's request ID grammar has no path separator or leading dot. */
function location(
  root: string,
  id: RequestId,
): string {
  return resolve(root, `${id}.json`);
}
/**
 * `journal-corrupt` naming the damaged file. The request may have committed before the file was
 * damaged, so its receipt is checked before authoring again under a new request ID.
 */
function corrupt(
  path: string,
  id: RequestId,
): FailureInput {
  return {
    code: 'journal-corrupt',
    message: `Retained request file is damaged: ${path}`,
    recovery: `Check canvas receipt ${id}, then author again under a new request ID.`,
  };
}
