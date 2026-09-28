/*
 * Connection kind policy: the relationship kinds a section mode and both endpoints allow, in
 * policy order. A kind needs both endpoints' object kinds to fit its policy, and a `calls` target
 * Model can resolve as callable. Pure; the tables arrive through ConnectionPolicy.
 */
import type { Collection, Section } from '../../../contract/records/owners.js';
import type {
  ConnectionEndpointView,
  RelationshipKind,
} from '../../../contract/records/connection.js';
import type { ConnectionPolicy } from './types.js';
import { relationshipEndpoint } from './endpoints.js';

/** The relationship kinds the section mode and both endpoints allow, in policy order. */
export function connectionKinds(
  policy: ConnectionPolicy,
  mode: Section['mode'],
  collection: Collection,
  source: ConnectionEndpointView['kind'],
  target: ConnectionEndpointView,
): readonly RelationshipKind[] {
  const candidates = policy.compatibleWires[mode] ?? policy.allKinds;
  return candidates.filter((kind) =>
    connectionKindAllowed(policy, kind, source, target, collection),
  );
}

/** A kind is allowed when both endpoints' kinds fit its policy and a `calls` target is callable. */
function connectionKindAllowed(
  policy: ConnectionPolicy,
  kind: RelationshipKind,
  source: ConnectionEndpointView['kind'],
  target: ConnectionEndpointView,
  collection: Collection,
): boolean {
  return (
    endpointKindAllowed(policy.sourceEndpoints[kind], source) &&
    endpointKindAllowed(policy.targetEndpoints[kind], target.kind) &&
    (kind !== 'calls' || callableTargetExists(policy, collection, target))
  );
}

/** An absent policy entry allows every kind. */
function endpointKindAllowed(
  allowed: readonly ConnectionEndpointView['kind'][] | undefined,
  kind: ConnectionEndpointView['kind'],
): boolean {
  return allowed === undefined || allowed.includes(kind);
}

/** A `calls` relationship needs a target endpoint Model can resolve as callable. */
function callableTargetExists(
  policy: ConnectionPolicy,
  collection: Collection,
  target: ConnectionEndpointView,
): boolean {
  const endpoint = relationshipEndpoint(policy, target);
  return endpoint.ok && policy.callable(collection, endpoint.value) !== undefined;
}
