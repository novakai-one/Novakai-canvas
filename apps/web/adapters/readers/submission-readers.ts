import { z } from 'zod';
import { requestSchema, receiptSchema } from '@novakai/canvas-authoring';
import { transportGeneration } from '@novakai/canvas-service';
import { gestureId } from '@novakai/canvas-canvas';
import type { AppliedCommit, SubmissionReaders } from '../../contract/records/submission.js';
import type { WorkspaceDecoders } from '../../contract/ports/workspace-decoders.js';
import type { Receipt, Request } from '../../contract/records/owners.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
const submission = z.strictObject({
  request: requestSchema,
  generation: transportGeneration,
  sourceEdit: z.number().int().nonnegative(),
  gesture: gestureId.nullable(),
  state: z.enum(['sending', 'uncertain', 'retryable', 'rejected']),
});
/** The snapshot half stays unknown here; the workspace snapshot reader checks it. */
const appliedAnswer = z.strictObject({ receipt: receiptSchema, snapshot: z.unknown() });
/** Browser records are untrusted after restart; schemas admit their full request before recovery offers an action.
 * An apply answer's snapshot goes through the same checked reader as a workspace read.
 */
export function createSubmissionReaders(
  inputs: Pick<WorkspaceDecoders, 'snapshot'>,
): SubmissionReaders {
  return {
    pending: (input) => {
      const result = z.array(submission).max(100).safeParse(input);
      if (!result.success)
        return failure('invalid-recovery', 'Retained requests could not be read safely');
      return { ok: true, value: result.data };
    },
    receipt: readReceipt,
    applied: (input, request) => readApplied(input, request, inputs),
  };
}
/** Null is a valid lookup result; non-null values require schema and request-identity admission. */
function readReceipt(
  input: unknown,
  request: Request,
): ReturnType<SubmissionReaders['receipt']> {
  if (input === null) return { ok: true, value: null };
  const result = receiptSchema.safeParse(input);
  if (!result.success)
    return failure('invalid-receipt', 'The response did not contain an Authoring receipt');
  return matchingReceipt(result.data, request);
}
/** An apply answer must carry this request's receipt and a readable post-commit workspace. */
function readApplied(
  input: unknown,
  request: Request,
  inputs: Pick<WorkspaceDecoders, 'snapshot'>,
): Result<AppliedCommit> {
  const answer = appliedAnswer.safeParse(input);
  if (!answer.success)
    return failure('invalid-receipt', 'The response did not contain an Authoring receipt');
  return checkedApplied(
    matchingReceipt(answer.data.receipt, request),
    answer.data.snapshot,
    inputs,
  );
}
/** Neither half confirms alone: a foreign receipt or an unreadable workspace leaves the request unconfirmed. */
function checkedApplied(
  receipt: Result<Receipt>,
  snapshot: unknown,
  inputs: Pick<WorkspaceDecoders, 'snapshot'>,
): Result<AppliedCommit> {
  if (!receipt.ok) return receipt;
  const carried = inputs.snapshot(snapshot);
  if (!carried.ok) return carried;
  return { ok: true, value: { receipt: receipt.value, carried: carried.value } };
}
/** A valid receipt for another request cannot confirm this local draft. */
function matchingReceipt(
  receipt: Receipt,
  request: Request,
): Result<Receipt> {
  if (receipt.request !== request.request)
    return failure('invalid-receipt', 'The receipt belongs to a different request');
  return { ok: true, value: receipt };
}
