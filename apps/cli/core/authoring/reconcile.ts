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
import type { Observed, ReceiptLookup } from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';

/** What `retry` uses: the journal, the receipt read, and what `submit` uses. */
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
export async function retry(
  request: RequestId,
  dependencies: RetryDependencies,
): Promise<Result<string>> {
  const retained = await dependencies.journal.read(request);
  if (!retained.ok) return retained;
  const lookup = await dependencies.reads.receipt(request);
  if (!lookup.ok) return lookup;
  return reconciled(retained.value, lookup.value, dependencies);
}

/** Receipt absence permits explicit caller-requested replay; changed Authoring preconditions remain rejected by the owner. */
async function reconciled(
  record: JournalRecord,
  lookup: Observed<ReceiptLookup>,
  dependencies: RetryDependencies,
): Promise<Result<string>> {
  if (lookup.value.kind === 'committed')
    return matchedReceipt(lookup.value.receipt, record.request.request);
  return submit({ ...record, generation: lookup.generation }, 'apply', dependencies);
}
