/*
 * Read-only service queries: send one read route and turn the answer into text, plus the route of
 * each query that names a collection or request. Uses injected ports only; nothing is written to
 * the workspace. Service failures are returned whole; the caller fixes the named input and runs
 * the command again.
 */
import type { ReadScope } from '../../contract/records/command.js';
import type { CliDependencies } from '../../contract/ports/runtime.js';
import type { CollectionId, RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { rejected, success } from '../../contract/errors.js';

/** Read failures preserve the service diagnostic; successful payloads still pass their owner-specific readout. */
export async function query(
  path: string,
  format: (input: unknown) => Result<string>,
  dependencies: Pick<CliDependencies, 'transport'>,
): Promise<Result<string>> {
  const result = await dependencies.transport.get(path);
  if (!result.ok) return result;
  if (!result.value.outcome.ok) return rejected('service-rejected', result.value.outcome.error);
  return format(result.value.outcome.value);
}
/** Read-only grammar inspection is JSON output, never a requirement to author diagram JSON. */
export function describe(value: unknown): Result<string> {
  return success(JSON.stringify(value, null, 2));
}
/** The `/api/v1/source` route for one collection, narrowed to a section or object when the scope names one. */
export function sourcePath(
  collection: CollectionId,
  scope: ReadScope,
): string {
  const query = new URLSearchParams({ id: collection });
  if (scope.kind !== 'all') query.set(scope.kind, scope.id);
  return `/api/v1/source?${query.toString()}`;
}
/** The `/api/v1/inspect` route for one collection. */
export function inspectPath(collection: CollectionId): string {
  return `/api/v1/inspect?id=${encodeURIComponent(collection)}`;
}
/** The `/api/v1/receipt` route for one request. */
export function receiptPath(request: RequestId): string {
  return `/api/v1/receipt?id=${encodeURIComponent(request)}`;
}
