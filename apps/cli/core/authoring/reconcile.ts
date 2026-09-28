/*
 * `retry` and `apply`: read the retained request, look up its receipt first, and replay the
 * identical Authoring request only when no receipt exists. Uses injected ports only. Authoring owns
 * the commit; the retained request file is the CLI's recovery record.
 */
import { submit } from './submit.js';
import type { SubmitDependencies } from './submit.js';
import { matchedReceipt } from '../reads/receipt.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { RequestJournal } from '../../contract/ports/request-journal.js';
import type { JournalRecord } from '../../contract/records/retained-request.js';
import type { Receipt } from '../../contract/records/foreign.js';
import type { Observed } from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';

/** What `replayRetainedRequest` uses: the journal, the receipt read, and what `submit` uses. */
export interface RetryDependencies extends SubmitDependencies {
  readonly journal: RequestJournal;
  readonly reads: Pick<ServiceReads, 'receipt'>;
}

/**
 * Replay checks for a completed receipt first. A restarted host receives the identical Authoring
 * request under its new transport generation. Fails as the journal read does
 * (`request-unavailable`, `journal-corrupt`), as the receipt lookup does, with `invalid-response`
 * for a receipt of another request, or as `submit` does.
 */
export async function replayRetainedRequest(
  request: RequestId,
  dependencies: RetryDependencies,
): Promise<Result<string>> {
  const retained = await dependencies.journal.read(request);
  if (!retained.ok) return retained;
  const receipt = await dependencies.reads.receipt(request);
  if (!receipt.ok) return receipt;
  return reconciled(retained.value, receipt.value, dependencies);
}

/** Receipt absence permits explicit caller-requested replay; changed Authoring preconditions remain rejected by the owner. */
async function reconciled(
  record: JournalRecord,
  receipt: Observed<Receipt | null>,
  dependencies: RetryDependencies,
): Promise<Result<string>> {
  if (receipt.value !== null) return matchedReceipt(receipt.value, record.request.request);
  return submit({ ...record, generation: receipt.generation }, 'apply', dependencies);
}
