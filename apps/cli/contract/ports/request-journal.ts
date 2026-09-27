/*
 * The request journal: the CLI's recovery record for `receipt` then `retry`. Declaration only;
 * adapters/files/request-journal.ts implements it under the workspace `requests` directory. Every
 * method returns its failure as a value.
 */
import type { RequestId } from '../brands.js';
import type { LocalFailure, Result } from '../errors.js';
import type { JournalRecord, RetainedRequest } from '../records/retained-request.js';

/** Retains a request before it is sent, and reads it back for a replay. */
export interface RequestJournal {
  /**
   * Retains `retained` durably before anything is sent. Saving the same request again succeeds.
   * Fails with `retention-unavailable`, `journal-corrupt` (the ID's retained file is damaged) or
   * `request-reused` (the ID is retained for a different request). Nothing was sent on failure.
   */
  save(retained: RetainedRequest): Promise<Result<void, LocalFailure>>;
  /**
   * The retained request and its byte backups. Fails with `request-unavailable` (missing or
   * unreadable) or `journal-corrupt` (the file is not a journal record).
   */
  read(request: RequestId): Promise<Result<JournalRecord, LocalFailure>>;
}
