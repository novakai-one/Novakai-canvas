/*
 * Authoring preview and apply over the HTTP transport: the mutation envelope, one route per mode,
 * and the apply answer's receipt check. Network I/O through the injected transport; each failure
 * is returned as a value. Authoring owns the commit. The request was retained before it was sent,
 * so an unconfirmed answer names it: `canvas receipt ID`, then `canvas retry ID`.
 */
import type { HttpTransport, WriteRoute } from '../../contract/ports/http-transport.js';
import type { ServiceAuthoring } from '../../contract/ports/service-authoring.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type {
  ChangePreview,
  ServiceAnswer,
  ReceiptLookup,
  SubmitMode,
} from '../../contract/records/service-answers.js';
import {
  appliedAnswerSchema,
  changePreviewSchema,
  receiptAnswerSchema,
} from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
import type { CliFailure, Result } from '../../contract/errors.js';
import { failure, success, unconfirmedApplyFailure } from '../../contract/errors.js';

/** The transport's POST; this adapter never sends a GET. */
type TransportPost = Pick<HttpTransport, 'post'>;

/** The Authoring route of each mode. */
const routes: Readonly<Record<SubmitMode, WriteRoute>> = Object.freeze({
  preview: '/api/v1/authoring/preview',
  apply: '/api/v1/authoring/apply',
});

/**
 * Binds preview and apply to `transport`. Both fail with `service-rejected`, or with
 * `connection-uncertain` / `invalid-response` whose recovery names the request's receipt.
 */
export function createServiceAuthoring(transport: TransportPost): ServiceAuthoring {
  return {
    preview: (retained) => preview(transport, retained),
    apply: (retained) => apply(transport, retained),
  };
}

/**
 * Authoring's preview answer, checked only to be JSON: printed as it came. Fails as {@link send}
 * does, or with `invalid-response` when the answer is not JSON; its recovery names the request's
 * receipt, as {@link unconfirmed} does.
 */
async function preview(
  transport: TransportPost,
  retained: RetainedRequest,
): Promise<Result<ChangePreview>> {
  const answer = await send(transport, retained, 'preview');
  if (!answer.ok) return answer;
  const checked = changePreviewSchema.safeParse(answer.value.value);
  if (!checked.success)
    return failure({
      code: 'invalid-response',
      message: 'Service returned an invalid preview',
      recovery: receiptFirst(retained.request.request),
    });
  return success(checked.data);
}

/**
 * Whether the apply answer carries a committed receipt. Fails as {@link send} or
 * {@link appliedReceipt} does.
 */
async function apply(
  transport: TransportPost,
  retained: RetainedRequest,
): Promise<Result<ReceiptLookup>> {
  const answer = await send(transport, retained, 'apply');
  if (!answer.ok) return answer;
  return appliedReceipt(answer.value.value, retained.request.request);
}

/**
 * Sends the retained request in Authoring's mutation envelope; never its byte backups. Fails as the
 * transport does, with the recovery {@link unconfirmed} sets.
 */
async function send(
  transport: TransportPost,
  retained: RetainedRequest,
  mode: SubmitMode,
): Promise<Result<ServiceAnswer<unknown>>> {
  const answer = await transport.post(routes[mode], {
    version: 1,
    generation: retained.generation,
    request: retained.request,
    preview: mode === 'preview',
  });
  if (!answer.ok) return unconfirmed(answer.error, retained.request.request);
  return answer;
}

/**
 * A lost or unreadable answer (`connection-uncertain`, `invalid-response`) names the retained
 * request instead of suggesting a new request ID. A service rejection is returned whole.
 */
function unconfirmed(
  error: CliFailure,
  id: RequestId,
): Result<never> {
  if (error.code === 'connection-uncertain' || error.code === 'invalid-response')
    return { ok: false, error: { ...error, recovery: receiptFirst(id) } };
  return { ok: false, error };
}

/** The recovery of an unconfirmed answer: check `id`'s receipt; retry only when there is none. */
function receiptFirst(id: RequestId): string {
  return `Run canvas receipt ${id}, then canvas retry ${id} only if no receipt exists.`;
}

/**
 * The apply answer's receipt half, checked by Authoring's receipt schema. An answer without one,
 * or with a malformed one, does not confirm the commit: `invalid-response`, check the receipt.
 */
function appliedReceipt(
  value: unknown,
  request: RequestId,
): Result<ReceiptLookup> {
  const answer = appliedAnswerSchema.safeParse(value);
  if (!answer.success)
    return unconfirmedApplyFailure(request, 'Service returned an invalid apply confirmation');
  const receipt = receiptAnswerSchema.safeParse(answer.data.receipt);
  if (!receipt.success)
    return unconfirmedApplyFailure(request, 'Service returned an invalid receipt');
  return success(receipt.data);
}
