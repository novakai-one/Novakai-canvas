/*
 * Sending one retained Authoring request to preview or apply. Declaration only;
 * adapters/service-http/authoring.ts implements it over the HTTP transport. Authoring owns the
 * commit. The request is retained before it is sent, so an unconfirmed answer is recovered with
 * `canvas receipt ID`, then `canvas retry ID` only when no receipt exists.
 */
import type { Result } from '../errors.js';
import type { RetainedRequest } from '../records/retained-request.js';
import type { ChangePreview, ReceiptLookup } from '../records/service-answers.js';

/**
 * Sends the retained request under its generation; nothing is retried. Every method fails with
 * `service-rejected` (the service's own failure record, kept whole), or with
 * `connection-uncertain` or `invalid-response` whose recovery names the request's receipt.
 */
export interface ServiceAuthoring {
  /** Authoring's preview of the change; nothing is committed. Printed as JSON. */
  preview(retained: RetainedRequest): Promise<Result<ChangePreview>>;
  /**
   * The receipt the apply answer carries, checked by Authoring's receipt schema: `committed`, or
   * `none` when the answer carried no committed receipt. The receipt is not yet matched to the
   * request.
   */
  apply(retained: RetainedRequest): Promise<Result<ReceiptLookup>>;
}
