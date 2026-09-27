/*
 * Read-only service queries: send one read route and turn the answer into text, plus the route and
 * query of each read that names a collection or request. Uses injected ports only; nothing is
 * written to the workspace. Service failures are returned whole; the caller fixes the named input
 * and runs the command again.
 */
import type { ReadScope } from '../../contract/records/command.js';
import type { HttpTransport, ReadRoute, RouteQuery } from '../../contract/ports/http-transport.js';
import type { CollectionId, RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';

/** One read: its route and, when it names a collection or request, its query. */
export interface ReadTarget {
  readonly route: ReadRoute;
  readonly query?: RouteQuery;
}

/** Read failures preserve the service diagnostic; successful payloads still pass their owner-specific readout. */
export async function query(
  target: ReadTarget,
  format: (input: unknown) => Result<string>,
  dependencies: { readonly transport: Pick<HttpTransport, 'get'> },
): Promise<Result<string>> {
  const answer = await dependencies.transport.get(target.route, target.query);
  if (!answer.ok) return answer;
  return format(answer.value.value);
}
/** Read-only grammar inspection is JSON output, never a requirement to author diagram JSON. */
export function describe(value: unknown): Result<string> {
  return success(JSON.stringify(value, null, 2));
}
/** The `/api/v1/source` read of one collection, narrowed to a section or object when the scope names one. */
export function sourceRead(
  collection: CollectionId,
  scope: ReadScope,
): ReadTarget {
  if (scope.kind === 'all') return { route: '/api/v1/source', query: { id: collection } };
  return { route: '/api/v1/source', query: { id: collection, [scope.kind]: scope.id } };
}
/** The `/api/v1/inspect` read of one collection. */
export function inspectRead(collection: CollectionId): ReadTarget {
  return { route: '/api/v1/inspect', query: { id: collection } };
}
/** The `/api/v1/receipt` read of one request. */
export function receiptRead(request: RequestId): ReadTarget {
  return { route: '/api/v1/receipt', query: { id: request } };
}
