/*
 * Why this file exists
 *
 * When a change's answer is lost, the agent can't tell whether it was saved. So
 * `pnpm canvas retry req-1` checks first. If req-1 has a receipt, it prints that receipt. If not,
 * it sends the request kept in the journal again, exactly as it was. `apply` works the same way.
 *
 * This file does that check, then that send. It never builds a new request, so Authoring still
 * refuses it if the workspace changed. Each step gives back a `Result` (see `contract/errors.ts`).
 */
import { submitRequest } from './submit.js';
import type { SubmitDependencies } from './submit.js';
import { formatReceipt } from '../reads/receipt.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { RequestJournal } from '../../contract/ports/request-journal.js';
import type { JournalRecord, RetainedRequest } from '../../contract/records/retained-request.js';
import type { ServiceAnswer, ReceiptLookup } from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';

/** The tools a retry uses: the request journal, the receipt read, and the tools sending uses. */
export interface RetryDependencies extends SubmitDependencies {
  readonly journal: RequestJournal;
  readonly reads: Pick<ServiceReads, 'receipt'>;
}

/**
 * Sends the request kept under `request` again, unless its receipt shows it was already saved.
 * Gives back the text to print: the receipt, either way.
 * The mistakes it can find: no kept request or a damaged one (`request-unavailable`,
 * `journal-corrupt`), a receipt for another request (`invalid-response`), or a failed read or send.
 */
export async function replayRetainedRequest(
  request: RequestId,
  dependencies: RetryDependencies,
): Promise<Result<string>> {
  const kept = await dependencies.journal.read(request);
  if (!kept.ok) {
    return kept;
  }
  const receiptAnswer = await dependencies.reads.receipt(request);
  if (!receiptAnswer.ok) {
    return receiptAnswer;
  }
  return showReceiptOrResend(kept.value, receiptAnswer.value, dependencies);
}

/**
 * Gives back the receipt when the kept request was already saved. Otherwise sends it again, under
 * the running service's generation.
 */
async function showReceiptOrResend(
  kept: JournalRecord,
  receiptAnswer: ServiceAnswer<ReceiptLookup>,
  dependencies: RetryDependencies,
): Promise<Result<string>> {
  const lookup = receiptAnswer.value;
  if (lookup.kind === 'committed') {
    return formatReceipt(lookup.receipt, kept.request.request);
  }
  const resent: RetainedRequest = { ...kept, generation: receiptAnswer.generation };
  return submitRequest(resent, 'apply', dependencies);
}
