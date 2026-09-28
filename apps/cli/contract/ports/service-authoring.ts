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
import type { Receipt } from '../records/foreign.js';
import type { RetainedRequest } from '../records/retained-request.js';
import type { ChangePreview } from '../records/service-answers.js';

/**
 * Sends a kept request to Authoring. Each fails with `service-rejected` (the service said no),
 * or with `connection-uncertain` or `invalid-response`, whose advice names the request's receipt.
 */
export interface ServiceAuthoring {
  /** Asks Authoring what the change would do, without saving it. The preview prints as JSON. */
  preview(retained: RetainedRequest): Promise<Result<ChangePreview>>;
  /**
   * Asks Authoring to save the change, and gives back Authoring's receipt. An answer with no
   * receipt fails with `invalid-response`: the save isn't confirmed, so check `canvas receipt ID`.
   * `core/authoring/submit.ts` then checks the receipt is for this request.
   */
  apply(retained: RetainedRequest): Promise<Result<Receipt>>;
}
