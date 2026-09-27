/*
 * The service's read routes over the HTTP transport, each answer checked at this seam. Network I/O
 * through the injected transport; each failure is returned as a value. Nothing is written, so the
 * caller recovers by running the command again.
 */
import type { z } from 'zod';
import type { HttpTransport, RouteQuery } from '../../contract/ports/http-transport.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { ReadScope } from '../../contract/records/command.js';
import type { Observed } from '../../contract/records/service-answers.js';
import { readoutAnswer } from '../../contract/records/service-answers.js';
import { receiptSchema, snapshotSchema } from '../../contract/schemas.js';
import type { CollectionId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** The transport's GET; a read never posts. */
type TransportGet = Pick<HttpTransport, 'get'>;

/**
 * Binds the read routes to `transport`. Every method fails as the transport does, or with
 * `invalid-response` when the answer does not match its schema.
 */
export function createServiceReads(transport: TransportGet): ServiceReads {
  return {
    language: () => value(transport.get('/api/v1/language')),
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
          readoutAnswer,
          'Service returned an invalid source readout',
        ),
      ),
    inspect: (collection) => value(transport.get('/api/v1/inspect', { id: collection })),
    receipt: (request) =>
      observed(
        transport.get('/api/v1/receipt', { id: request }),
        receiptSchema.nullable(),
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

/** The answer's value without its generation, which the caller does not need. */
async function value<T>(pending: Promise<Result<Observed<T>>>): Promise<Result<T>> {
  const answer = await pending;
  if (!answer.ok) return answer;
  return success(answer.value.value);
}

/**
 * The answer as `schema` checks it, under the generation it came from. Fails as the transport
 * does, or with `invalid-response` and the message `invalid`.
 */
async function observed<T>(
  pending: Promise<Result<Observed<unknown>>>,
  schema: z.ZodType<T>,
  invalid: string,
): Promise<Result<Observed<T>>> {
  const answer = await pending;
  if (!answer.ok) return answer;
  const parsed = schema.safeParse(answer.value.value);
  if (!parsed.success) return failure({ code: 'invalid-response', message: invalid });
  return success({ generation: answer.value.generation, value: parsed.data });
}
