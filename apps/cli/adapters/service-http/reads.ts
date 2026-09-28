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
import type {
  LanguageDescription,
  ReadAnswer,
  ReceiptLookup,
  ServiceAnswer,
} from '../../contract/records/service-answers.js';
import type { InspectionReport, WorkspaceSnapshot } from '../../contract/records/foreign.js';
import {
  languageDescriptionSchema,
  readAnswerSchema,
  receiptAnswerSchema,
} from '../../contract/records/service-answers.js';
import type { Parser } from '../../contract/schemas.js';
import { snapshotSchema } from '../../contract/schemas.js';
import type { CollectionId, RequestId } from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** The transport's GET; a read never posts. */
type TransportGet = Pick<HttpTransport, 'get'>;

/**
 * Gives core its read questions, asked over `transport`. Each fails as the transport does, or
 * with `invalid-response` when the answer isn't the expected shape.
 */
export function createServiceReads(transport: TransportGet): ServiceReads {
  return {
    vocabulary: () => readVocabulary(transport),
    workspace: () => readWorkspace(transport),
    source: (collection, scope) => readSource(transport, collection, scope),
    inspect: (collection) => readInspection(transport, collection),
    receipt: (request) => readReceipt(transport, request),
  };
}

/** Asks for the DSL vocabulary, and checks the answer is a language description. */
async function readVocabulary(transport: TransportGet): Promise<Result<LanguageDescription>> {
  const answer = await transport.get('/api/v1/language');
  if (!answer.ok) {
    return answer;
  }
  return checkAnswerValue(
    answer.value,
    languageDescriptionSchema,
    'Service returned an invalid language description',
  );
}

/** Asks for every saved record in the workspace, and checks the answer is a workspace snapshot. */
async function readWorkspace(
  transport: TransportGet,
): Promise<Result<ServiceAnswer<WorkspaceSnapshot>>> {
  const answer = await transport.get('/api/v1/workspace');
  if (!answer.ok) {
    return answer;
  }
  return checkAnswer(
    answer.value,
    snapshotSchema,
    'Service returned an invalid workspace snapshot',
  );
}

/** Asks for a collection's source, or one section or object of it, and checks the readout. */
async function readSource(
  transport: TransportGet,
  collection: CollectionId,
  scope: ReadScope,
): Promise<Result<ReadAnswer>> {
  const query = sourceQuery(collection, scope);
  const answer = await transport.get('/api/v1/source', query);
  if (!answer.ok) {
    return answer;
  }
  return checkAnswerValue(
    answer.value,
    readAnswerSchema,
    'Service returned an invalid source readout',
  );
}

/** Asks for the service's layout report on a collection, and checks the answer is one. */
async function readInspection(
  transport: TransportGet,
  collection: CollectionId,
): Promise<Result<InspectionReport>> {
  const answer = await transport.get('/api/v1/inspect', { id: collection });
  if (!answer.ok) {
    return answer;
  }
  return checkAnswerValue(
    answer.value,
    inspectionReport,
    'Service returned an invalid inspection report',
  );
}

/** Asks whether a request was saved, and checks the answer is a receipt or none. */
async function readReceipt(
  transport: TransportGet,
  request: RequestId,
): Promise<Result<ServiceAnswer<ReceiptLookup>>> {
  const answer = await transport.get('/api/v1/receipt', { id: request });
  if (!answer.ok) {
    return answer;
  }
  return checkAnswer(answer.value, receiptAnswerSchema, 'Service returned an invalid receipt');
}

/** Makes the source query: `id`, then `section` or `object` when the scope names one. */
function sourceQuery(
  collection: CollectionId,
  scope: ReadScope,
): RouteQuery {
  if (scope.kind === 'all') {
    return { id: collection };
  }
  return { id: collection, [scope.kind]: scope.id };
}

/** Checks the answer's value has the expected shape, and gives it without its generation. */
function checkAnswerValue<T>(
  answer: ServiceAnswer<unknown>,
  schema: Parser<T>,
  invalidMessage: string,
): Result<T> {
  const checked = schema.safeParse(answer.value);
  if (!checked.success) {
    return invalidResponseFailure(invalidMessage);
  }
  return success(checked.data);
}

/** Checks the answer's value has the expected shape, and keeps the generation it came under. */
function checkAnswer<T>(
  answer: ServiceAnswer<unknown>,
  schema: Parser<T>,
  invalidMessage: string,
): Result<ServiceAnswer<T>> {
  const checked = schema.safeParse(answer.value);
  if (!checked.success) {
    return invalidResponseFailure(invalidMessage);
  }
  return success({ generation: answer.generation, value: checked.data });
}

/** Makes the mistake for an answer that isn't the expected shape (`invalid-response`). */
function invalidResponseFailure(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-response', message });
}
