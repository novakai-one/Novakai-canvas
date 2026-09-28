/*
 * Why this file exists
 *
 * If a change is sent and its answer is lost, the agent needs the exact same request to try
 * again. So the CLI keeps each request before sending it, in the request journal: the `requests`
 * folder of the workspace. `canvas retry ID` reads it back from there.
 *
 * This file names those two steps, keep and read back. `adapters/files/request-journal.ts` does
 * the file work.
 */
import type { RequestId } from '../brands.js';
import type { LocalFailure, Result } from '../errors.js';
import type { JournalRecord, RetainedRequest } from '../records/retained-request.js';

/** Keeps a request before it is sent, and reads it back for a retry. */
export interface RequestJournal {
  /**
   * Keeps `retained` safely on disk, before it is sent. Keeping the same request twice is fine.
   * Fails with `retention-unavailable`, `journal-corrupt` or `request-reused` (the ID is already
   * kept for a different request). The request is never sent after a failure.
   */
  save(retained: RetainedRequest): Promise<Result<void, LocalFailure>>;
  /**
   * Reads back the kept request for `request`, with its byte copies. Fails with
   * `request-unavailable` (missing or unreadable) or `journal-corrupt` (damaged, or another ID's).
   */
  read(request: RequestId): Promise<Result<JournalRecord, LocalFailure>>;
}
