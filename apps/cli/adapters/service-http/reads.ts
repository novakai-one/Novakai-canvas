/*
 * Why this file exists
 *
 * `read my-diagram` becomes `GET /api/v1/source?id=my-diagram`, and the answer is whatever came
 * back over the wire. Before core prints it, it must be checked to be the shape expected: a
 * source readout, a layout report, a receipt.
 *
 * This file asks the service each read question and checks each answer. Reading never changes
 * the workspace, so a failed read can simply be run again. Mistakes come back as values.
 */
import { inspectionReport } from '@novakai/canvas-service';
import type { HttpTransport, RouteQuery } from '../../contract/ports/http-transport.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { ReadScope } from '../../contract/records/command.js';
import type { ServiceAnswer } from '../../contract/records/service-answers.js';
import {
  languageDescriptionSchema,
  readAnswerSchema,
  receiptAnswerSchema,
} from '../../contract/records/service-answers.js';
import type { Parser } from '../../contract/schemas.js';
import { snapshotSchema } from '../../contract/schemas.js';
import type { CollectionId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** The transport's GET; a read never posts. */
type TransportGet = Pick<HttpTransport, 'get'>;

/**
 * Gives core its read questions, asked over `transport`. Each fails as the transport does, or
 * with `invalid-response` when the answer isn't the expected shape.
 */
export function createServiceReads(transport: TransportGet): ServiceReads {
  return {
    vocabulary: () =>
      value(
        observed(
          transport.get('/api/v1/language'),
          languageDescriptionSchema,
          'Service returned an invalid language description',
        ),
      ),
    workspace: () =>
      observed(
        transport.get('/api/v1/workspace'),
        snapshotSchema,
        'Service returned an invalid workspace snapshot',
      ),
    source: (collection, scope) =>
      value(
        observed(
          transport.get('/api/v1/source', sourceQuery(collection, scope)),
          readAnswerSchema,
          'Service returned an invalid source readout',
        ),
      ),
    inspect: (collection) =>
      value(
        observed(
          transport.get('/api/v1/inspect', { id: collection }),
          inspectionReport,
          'Service returned an invalid inspection report',
        ),
      ),
    receipt: (request) =>
      observed(
        transport.get('/api/v1/receipt', { id: request }),
        receiptAnswerSchema,
        'Service returned an invalid receipt',
      ),
  };
}

/** `id`, then `section` or `object` when the scope names one. */
function sourceQuery(
  collection: CollectionId,
  scope: ReadScope,
): RouteQuery {
  if (scope.kind === 'all') return { id: collection };
  return { id: collection, [scope.kind]: scope.id };
}

/**
 * The answer's value without its generation, which the caller does not need. Fails as the
 * transport does.
 */
async function value<T>(pending: Promise<Result<ServiceAnswer<T>>>): Promise<Result<T>> {
  const answer = await pending;
  if (!answer.ok) return answer;
  return success(answer.value.value);
}

/**
 * The answer as `schema` checks it, under the generation it came from. Fails as the transport
 * does, or with `invalid-response` and the message `invalid`.
 */
async function observed<T>(
  pending: Promise<Result<ServiceAnswer<unknown>>>,
  schema: Parser<T>,
  invalid: string,
): Promise<Result<ServiceAnswer<T>>> {
  const answer = await pending;
  if (!answer.ok) return answer;
  const parsed = schema.safeParse(answer.value.value);
  if (!parsed.success) return failure({ code: 'invalid-response', message: invalid });
  return success({ generation: answer.value.generation, value: parsed.data });
}
