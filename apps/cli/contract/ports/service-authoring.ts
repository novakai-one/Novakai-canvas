/*
 * Why this file exists
 *
 * A change is saved by Authoring, inside the service, never by the CLI. The CLI sends it one of
 * two ways: `preview` asks what the change would do, and `apply` asks Authoring to save it. If an
 * apply's answer is lost, the agent runs `canvas receipt ID`, then `canvas retry ID` if nothing
 * was saved.
 *
 * This file names those two sends. It never retries by itself.
 * `adapters/service-http/authoring.ts` makes the calls.
 */
import type { Result } from '../errors.js';
import type { RetainedRequest } from '../records/retained-request.js';
import type { ChangePreview, ReceiptLookup } from '../records/service-answers.js';

/**
 * Sends a kept request to Authoring. Each fails with `service-rejected` (the service said no),
 * or with `connection-uncertain` or `invalid-response`, whose advice names the request's receipt.
 */
export interface ServiceAuthoring {
  /** Asks Authoring what the change would do, without saving it. The preview prints as JSON. */
  preview(retained: RetainedRequest): Promise<Result<ChangePreview>>;
  /**
   * Asks Authoring to save the change. Gives back `committed` with the answer's receipt, or `none`
   * when the answer holds no receipt. The receipt isn't matched to the request here.
   */
  apply(retained: RetainedRequest): Promise<Result<ReceiptLookup>>;
}
