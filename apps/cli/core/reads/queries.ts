/*
 * Read-only service commands: `describe`, `list`, `read`, `inspect` and `receipt`. Each asks the
 * service once through the injected reads port and turns the checked answer into text. Nothing is
 * written to the workspace; service failures are returned whole, and the caller fixes the named
 * input and runs the command again.
 */
import type { CollectionValidator } from '../../contract/ports/collection-validator.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { ReadScope } from '../../contract/records/command.js';
import type { CollectionId, RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { mapped } from '../shared/results.js';
import { collectionLines } from './collections.js';
import { lookedUpReceipt } from './receipt.js';
import { sourceText } from './source.js';

/** What the read commands use: the service's read calls and Model's collection check. */
export interface ReadDependencies {
  readonly reads: ServiceReads;
  readonly collections: CollectionValidator;
}

/** `describe`: the DSL vocabulary as JSON. Fails as the read does. */
export async function describeLanguage(dependencies: ReadDependencies): Promise<Result<string>> {
  return mapped(await dependencies.reads.vocabulary(), json);
}

/** `list`: one line per live collection. Fails as the workspace read does. */
export async function listCollections(dependencies: ReadDependencies): Promise<Result<string>> {
  const current = await dependencies.reads.workspace();
  return mapped(current, (observed) => collectionLines(observed.value, dependencies.collections));
}

/** `read`: the collection's source under its revision comment. Fails as the source read does. */
export async function readCollection(
  collection: CollectionId,
  scope: ReadScope,
  dependencies: ReadDependencies,
): Promise<Result<string>> {
  return mapped(await dependencies.reads.source(collection, scope), sourceText);
}

/** `inspect`: the service's inspection report as JSON. Fails as the inspect read does. */
export async function inspectCollection(
  collection: CollectionId,
  dependencies: ReadDependencies,
): Promise<Result<string>> {
  return mapped(await dependencies.reads.inspect(collection), json);
}

/**
 * `receipt`: the request's receipt, or that none exists. Fails as the receipt read does, or with
 * `invalid-response` when the receipt names another request.
 */
export async function readReceipt(
  request: RequestId,
  dependencies: ReadDependencies,
): Promise<Result<string>> {
  const found = await dependencies.reads.receipt(request);
  if (!found.ok) return found;
  return lookedUpReceipt(found.value.value, request);
}

/** Read-only grammar and inspection output is JSON, never a requirement to author diagram JSON. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
