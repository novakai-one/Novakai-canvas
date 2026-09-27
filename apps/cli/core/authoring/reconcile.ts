/*
 * `retry` and `apply`: read the retained request, look up its receipt first, and replay the
 * identical Authoring request only when no receipt exists. Uses injected ports only. Authoring owns
 * the commit; the retained request file is the CLI's recovery record.
 */
import { submit } from './submit.js';
import type { SubmitDependencies } from './submit.js';
import { receiptRead } from '../reads/queries.js';
import type { SemanticInputs } from '../../contract/ports/runtime.js';
import type { HttpTransport } from '../../contract/ports/http-transport.js';
import type { RequestJournal } from '../../contract/ports/request-journal.js';
import type { JournalRecord } from '../../contract/records/retained-request.js';
import type { Observed } from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';

/** What `retry` uses: the journal, the transport, and the receipt and apply-answer readers. */
export interface RetryDependencies extends SubmitDependencies {
  readonly journal: RequestJournal;
  readonly transport: HttpTransport;
  readonly semantic: Pick<SemanticInputs, 'receipt' | 'applied'>;
}

/**
 * Replay checks for a completed receipt first. A restarted host receives the identical Authoring
 * request under its new transport generation. Fails with `request-unavailable`, as the receipt
 * lookup does, or as `submit` does.
 */
export async function retry(
  request: RequestId,
  dependencies: RetryDependencies,
): Promise<Result<string>> {
  const retained = await dependencies.journal.read(request);
  if (!retained.ok) return retained;
  const lookup = receiptRead(request);
  const receipt = await dependencies.transport.get(lookup.route, lookup.query);
  if (!receipt.ok) return receipt;
  return reconciled(retained.value, receipt.value, dependencies);
}
/** Receipt absence permits explicit caller-requested replay; changed Authoring preconditions remain rejected by the owner. */
async function reconciled(
  record: JournalRecord,
  receipt: Observed<unknown>,
  dependencies: RetryDependencies,
): Promise<Result<string>> {
  if (receipt.value !== null)
    return dependencies.semantic.receipt(receipt.value, {
      kind: 'committed',
      request: record.request.request,
    });
  return submit({ ...record, generation: receipt.generation }, false, dependencies);
}
