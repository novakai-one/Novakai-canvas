/*
 * Why this file exists
 *
 * If a change is sent and its answer is lost, `canvas retry ID` must send the exact same request
 * again. So each request is kept on disk before it is sent, as `requests/<ID>.json` in the
 * workspace folder, and read back from there.
 *
 * This file does that keeping and reading back. It writes each file once, synced to disk, and
 * never rewrites or deletes it. A file that holds something else, or another request, is
 * `journal-corrupt`. Mistakes come back as values, never thrown.
 */
import { readFile, mkdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FilePath, RequestId } from '../../contract/brands.js';
import { journalFileSchema } from '../../contract/records/retained-request.js';
import type { JournalRecord, RetainedRequest } from '../../contract/records/retained-request.js';
import type { RequestJournal } from '../../contract/ports/request-journal.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Gives core the request journal kept in the `requests` folder of `workspace`. Makes no folder
 * until the first request is kept.
 */
export function createRequestJournal(workspace: FilePath): RequestJournal {
  const journalFolder = resolve(workspace, 'requests');
  return {
    save: (retained) => saveRequest(journalFolder, retained),
    read: (id) => readRequest(journalFolder, id),
  };
}

/** Keeps the request in its own journal file, making the journal folder first if it is missing. */
async function saveRequest(
  journalFolder: string,
  retained: RetainedRequest,
): Promise<Result<void, LocalFailure>> {
  // Any throw here, including one from writing the file, means the request isn't safely kept.
  try {
    await mkdir(journalFolder, { recursive: true, mode: 0o700 });
    const requestFile = requestFilePath(journalFolder, retained.request.request);
    return await keepOnce(requestFile, retained);
  } catch {
    return retentionUnavailableFailure();
  }
}

/** Writes the request to a new file; when the file can't be made, checks what it already holds. */
async function keepOnce(
  requestFile: string,
  retained: RetainedRequest,
): Promise<Result<void, LocalFailure>> {
  const newFile = await createNewFile(requestFile);
  if (newFile === undefined) {
    return checkAlreadyKept(requestFile, retained);
  }
  return writeAndSync(newFile, retained);
}

/** Creates the file only if nothing is there yet; `undefined` when it can't be created. */
async function createNewFile(requestFile: string): Promise<FileHandle | undefined> {
  try {
    return await open(requestFile, 'wx', 0o600);
  } catch {
    return undefined;
  }
}

/** Writes the request as JSON into the new file, syncs it to disk, and always closes the file. */
async function writeAndSync(
  newFile: FileHandle,
  retained: RetainedRequest,
): Promise<Result<void, LocalFailure>> {
  try {
    const journalText = JSON.stringify(retained);
    await newFile.writeFile(journalText);
    await newFile.sync();
    return success(undefined);
  } finally {
    await newFile.close();
  }
}

/** Checks the file already kept under this ID holds the same request; it is not rewritten. */
async function checkAlreadyKept(
  requestFile: string,
  retained: RetainedRequest,
): Promise<Result<void, LocalFailure>> {
  const kept = await readKeptRecord(requestFile, retained.request.request);
  if (!kept.ok) {
    return kept;
  }
  if (isDifferentRequest(kept.value, retained)) {
    return requestReusedFailure();
  }
  return success(undefined);
}

/** Reads back the journal record already kept for `id`, while saving it again. */
async function readKeptRecord(
  requestFile: string,
  id: RequestId,
): Promise<Result<JournalRecord, LocalFailure>> {
  const journalText = await readJournalText(requestFile);
  if (journalText === undefined) {
    return retentionUnavailableFailure();
  }
  return decodeJournalRecord(journalText, requestFile, id);
}

/** Whether the kept request differs from the one being saved, compared as JSON text. */
function isDifferentRequest(
  kept: JournalRecord,
  retained: RetainedRequest,
): boolean {
  const keptJson = JSON.stringify(kept.request);
  const retainedJson = JSON.stringify(retained.request);
  return keptJson !== retainedJson;
}

/** Reads a kept request and its byte copies back from the journal, for a retry. */
async function readRequest(
  journalFolder: string,
  id: RequestId,
): Promise<Result<JournalRecord, LocalFailure>> {
  const requestFile = requestFilePath(journalFolder, id);
  const journalText = await readJournalText(requestFile);
  if (journalText === undefined) {
    return requestUnavailableFailure();
  }
  return decodeJournalRecord(journalText, requestFile, id);
}

/** Reads a journal file's text; `undefined` when it is missing or can't be read. */
async function readJournalText(requestFile: string): Promise<string | undefined> {
  try {
    return await readFile(requestFile, 'utf8');
  } catch {
    return undefined;
  }
}

/** Checks the text is a journal record, in JSON, for request `id` and no other. */
function decodeJournalRecord(
  journalText: string,
  requestFile: string,
  id: RequestId,
): Result<JournalRecord, LocalFailure> {
  const json = parseJson(journalText);
  const journalFile = journalFileSchema.safeParse(json);
  if (!journalFile.success) {
    return journalCorruptFailure(requestFile, id);
  }
  const { request, backups } = journalFile.data;
  if (request.request !== id) {
    return journalCorruptFailure(requestFile, id);
  }
  return success({ request, backups });
}

/** Parses JSON text; text that isn't JSON gives `undefined`, which no journal file matches. */
function parseJson(journalText: string): unknown {
  try {
    return JSON.parse(journalText);
  } catch {
    return undefined;
  }
}

/** Gives the path of a request's journal file. A request ID has no `/` and no leading dot. */
function requestFilePath(
  journalFolder: string,
  id: RequestId,
): string {
  return resolve(journalFolder, `${id}.json`);
}

/** Makes the mistake for a request that couldn't be kept, so it wasn't sent. */
function retentionUnavailableFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'retention-unavailable',
    message: 'Cannot retain the request safely; no submission was made',
  });
}

/** Makes the mistake for a kept request whose file can't be read (`request-unavailable`). */
function requestUnavailableFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'request-unavailable',
    message: 'Retained request could not be read; inspect its receipt before submitting another',
  });
}

/** Makes the mistake for a request ID already kept for a different request (`request-reused`). */
function requestReusedFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'request-reused',
    message: 'This request ID is already retained for different authoring',
  });
}

/**
 * Makes the mistake for a damaged journal file (`journal-corrupt`). The request may have been saved
 * before the file was damaged, so the advice is to check its receipt before authoring again.
 */
function journalCorruptFailure(
  requestFile: string,
  id: RequestId,
): Result<never, LocalFailure> {
  return failure({
    code: 'journal-corrupt',
    message: `Retained request file is damaged: ${requestFile}`,
    recovery: `Check canvas receipt ${id}, then author again under a new request ID.`,
  });
}
