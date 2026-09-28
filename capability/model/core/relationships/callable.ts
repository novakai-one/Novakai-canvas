import type { DescendantId } from '../../contract/brands.js';
import type { Collection } from '../../contract/records/collection.js';
import type { Endpoint } from '../../contract/records/content.js';
import type { DiagramObject } from '../../contract/records/object.js';
import { descendants, type ObjectDescendant } from '../objects/content.js';

/** A resolved callable target: its owning object and, for a signature, the member. */
export interface CallableEndpoint {
  /** The collection's own object record that owns the target. */
  readonly owner: DiagramObject;
  /** For a signature target, a new `{ id, kind: 'signature' }` description; absent otherwise. */
  readonly member?: ObjectDescendant;
}

/**
 * Resolves a relationship endpoint to a callable target. Published as Model's
 * `resolveCallableEndpoint`; relationship and sequence validation use it too.
 *
 * Callable targets are a whole object of kind `function` (no `member`), or a `signature` member
 * of a `module`, `interface` or `function` object.
 *
 * @param collection - A validated collection.
 * @param endpoint - The relationship endpoint to resolve.
 * @returns A new result holding the owner (and, for a signature, the member), or `undefined` when
 * the endpoint is not callable or its owner or member does not exist. The result is not frozen.
 * `owner` is the collection's own object record (frozen if the collection came from `validate`);
 * `member` is a new `{ id, kind }` description, not frozen.
 * @throws Only if given data that is not a validated collection, or an endpoint that is not plain
 * parsed data (for example one whose getter throws); the endpoint is not checked here.
 */
export function resolveCallableEndpoint(
  collection: Collection,
  endpoint: Endpoint,
): CallableEndpoint | undefined {
  const owner = collection.objects.find(
    /** Tells whether this is the endpoint's object. */
    (object) => object.id === endpoint.object,
  );
  if (owner === undefined) {
    return undefined;
  }
  if (endpoint.member === undefined) {
    return resolveWholeCallable(owner);
  }
  return resolveMemberCallable(owner, endpoint.member);
}

/** Resolves an endpoint without a member: only a `function` object is callable as a whole. */
function resolveWholeCallable(owner: DiagramObject): CallableEndpoint | undefined {
  if (owner.kind === 'function') {
    return { owner };
  }
  return undefined;
}

/**
 * Resolves a member endpoint: the owner must be a `module`, `interface` or `function`, and the
 * member must be one of its `signature` blocks.
 */
function resolveMemberCallable(
  owner: DiagramObject,
  memberId: DescendantId,
): CallableEndpoint | undefined {
  if (!['module', 'interface', 'function'].includes(owner.kind)) {
    return undefined;
  }
  const member = descendants(owner).find(
    /** Tells whether this is the named member. */
    (candidate) => candidate.id === memberId,
  );
  if (member?.kind === 'signature') {
    return { owner, member };
  }
  return undefined;
}
