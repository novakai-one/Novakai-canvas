/*
 * Why this file exists
 *
 * `canvas create my-diagram.canvas` ends by sending the change to Authoring, inside the service,
 * as `POST /api/v1/authoring/apply`. If that answer is lost, the agent must not send a new
 * request: it checks `canvas receipt ID`, then runs `canvas retry ID` only if nothing was saved.
 *
 * This file sends a kept request to preview or apply, and checks the answer. When an answer is
 * lost or can't be read, the mistake tells the agent to run `canvas receipt ID` before any retry.
 * It never retries, and never saves anything itself; Authoring does. Mistakes come back as values.
 */
import type { HttpTransport, WriteRoute } from '../../contract/ports/http-transport.js';
import type { ServiceAuthoring } from '../../contract/ports/service-authoring.js';
import type { AuthoringRequest, Receipt } from '../../contract/records/foreign.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type {
  ChangePreview,
  ReceiptLookup,
  ServiceAnswer,
  SubmitMode,
} from '../../contract/records/service-answers.js';
import {
  appliedAnswerSchema,
  changePreviewSchema,
  receiptAnswerSchema,
} from '../../contract/records/service-answers.js';
import type { RequestId, ServiceGeneration } from '../../contract/brands.js';
import type { CliFailure, LocalFailure, Result } from '../../contract/errors.js';
import { failure, success, unconfirmedApplyFailure } from '../../contract/errors.js';

/** The transport's POST; this adapter never sends a GET. */
type TransportPost = Pick<HttpTransport, 'post'>;

/** What Authoring is sent: the kept request, its generation, and whether it is only a preview. */
interface AuthoringEnvelope {
  readonly version: 1;
  readonly generation: ServiceGeneration;
  readonly request: AuthoringRequest;
  readonly preview: boolean;
}

/** The Authoring route of each mode. */
const routes: Readonly<Record<SubmitMode, WriteRoute>> = Object.freeze({
  preview: '/api/v1/authoring/preview',
  apply: '/api/v1/authoring/apply',
});

/**
 * Gives core its preview and apply calls, made over `transport`. Both can fail with
 * `service-rejected`. A lost or unreadable answer (`connection-uncertain`, `invalid-response`)
 * tells the agent to check the request's receipt first.
 */
export function createServiceAuthoring(transport: TransportPost): ServiceAuthoring {
  return {
    preview: (retained) => sendPreview(transport, retained),
    apply: (retained) => sendApply(transport, retained),
  };
}

/** Sends the kept request to Authoring's preview route, and checks the answer is a preview. */
async function sendPreview(
  transport: TransportPost,
  retained: RetainedRequest,
): Promise<Result<ChangePreview>> {
  const answer = await sendToAuthoring(transport, retained, 'preview');
  if (!answer.ok) {
    return answer;
  }
  return checkPreview(answer.value, retained.request.request);
}

/** Sends the kept request to Authoring's apply route, and checks the answer holds its receipt. */
async function sendApply(
  transport: TransportPost,
  retained: RetainedRequest,
): Promise<Result<Receipt>> {
  const answer = await sendToAuthoring(transport, retained, 'apply');
  if (!answer.ok) {
    return answer;
  }
  return checkAppliedReceipt(answer.value, retained.request.request);
}

/**
 * Posts the kept request to Authoring, leaving out its byte copies. A lost or unreadable answer
 * gets advice to check the receipt first; a service rejection is passed on as it came.
 */
async function sendToAuthoring(
  transport: TransportPost,
  retained: RetainedRequest,
  mode: SubmitMode,
): Promise<Result<ServiceAnswer<unknown>>> {
  const envelope = authoringEnvelope(retained, mode);
  const answer = await transport.post(routes[mode], envelope);
  if (!answer.ok && isUnconfirmedAnswer(answer.error)) {
    return unconfirmedAnswerFailure(answer.error, retained.request.request);
  }
  return answer;
}

/** Wraps the kept request in the envelope Authoring reads. */
function authoringEnvelope(
  retained: RetainedRequest,
  mode: SubmitMode,
): AuthoringEnvelope {
  const isPreview = mode === 'preview';
  return {
    version: 1,
    generation: retained.generation,
    request: retained.request,
    preview: isPreview,
  };
}

/** Checks the preview answer is JSON. It is printed as it came. */
function checkPreview(
  answer: ServiceAnswer<unknown>,
  request: RequestId,
): Result<ChangePreview> {
  const preview = changePreviewSchema.safeParse(answer.value);
  if (!preview.success) {
    return invalidPreviewFailure(request);
  }
  return success(preview.data);
}

/** Checks the apply answer holds a receipt, as Authoring's receipt check reads it. */
function checkAppliedReceipt(
  answer: ServiceAnswer<unknown>,
  request: RequestId,
): Result<Receipt> {
  const applied = appliedAnswerSchema.safeParse(answer.value);
  if (!applied.success) {
    return unconfirmedApplyFailure(request, 'Service returned an invalid apply confirmation');
  }
  const lookup = receiptAnswerSchema.safeParse(applied.data.receipt);
  if (!lookup.success) {
    return unconfirmedApplyFailure(request, 'Service returned an invalid receipt');
  }
  return requireCommittedReceipt(lookup.data, request);
}

/** Gives the receipt when the answer holds one. No receipt (`none`) confirms nothing. */
function requireCommittedReceipt(
  lookup: ReceiptLookup,
  request: RequestId,
): Result<Receipt> {
  if (lookup.kind === 'none') {
    return unconfirmedApplyFailure(request, 'Apply returned no committed receipt');
  }
  return success(lookup.receipt);
}

/** Whether the answer was lost or couldn't be read, so the change may or may not be saved. */
function isUnconfirmedAnswer(transportFailure: CliFailure): transportFailure is LocalFailure {
  return (
    transportFailure.code === 'connection-uncertain' || transportFailure.code === 'invalid-response'
  );
}

/** Gives the advice for an answer that didn't arrive: check the receipt, retry only if none. */
function receiptFirstAdvice(request: RequestId): string {
  return `Run canvas receipt ${request}, then canvas retry ${request} only if no receipt exists.`;
}

/**
 * Makes the mistake for a lost or unreadable answer: the transport's mistake, with advice to check
 * the request's receipt, never to send a new request. Everything else about the mistake is kept.
 */
function unconfirmedAnswerFailure(
  transportFailure: LocalFailure,
  request: RequestId,
): Result<never, LocalFailure> {
  const advised: LocalFailure = { ...transportFailure, recovery: receiptFirstAdvice(request) };
  return { ok: false, error: advised };
}

/** Makes the mistake for a preview answer that isn't JSON (`invalid-response`). */
function invalidPreviewFailure(request: RequestId): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: 'Service returned an invalid preview',
    recovery: receiptFirstAdvice(request),
  });
}
