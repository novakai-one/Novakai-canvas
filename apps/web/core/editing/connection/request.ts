/*
 * Connection request assembly: a reviewed draft becomes one relationship record (cardinalities on
 * associations only) and the create request built by the model request builder — one
 * relationship, one wire appearance — under the request and relationship IDs the caller took from
 * the ID source. Pure; the session takes the IDs, sends the request and owns its recovery.
 */
import type { Result } from '../../../contract/errors.js';
import type { RequestBuilders } from '../../../contract/ports/request-builders.js';
import type { Change, Relationship, Request, Section } from '../../../contract/records/owners.js';
import type { Cardinality, ConnectionDraft } from '../../../contract/records/connection.js';
import type { RelationshipId, RequestId } from '../../../contract/brands.js';
import type { ConnectionPolicy, RelationshipEndpoints } from './types.js';
import { relationshipEndpoint } from './endpoints.js';

/** The new IDs one connection send needs: its request's and its relationship's. */
export interface ConnectionIds {
  readonly request: RequestId;
  readonly relationship: RelationshipId;
}

/**
 * Builds the create request for a reviewed draft under `ids.request`: one relationship with the ID
 * `ids.relationship`, one wire appearance. Fails as the endpoint checks do (`invalid-edit`) or as
 * the model builder does.
 */
export function connectionRequest(
  policy: ConnectionPolicy,
  builders: Pick<RequestBuilders, 'model'>,
  draft: ConnectionDraft,
  label: string,
  ids: ConnectionIds,
): Result<Request> {
  const relationship = relationshipFor(policy, draft, label, ids.relationship);
  if (!relationship.ok) {
    return relationship;
  }
  return builders.model(
    draft.base,
    draft.collection.id,
    relationshipChanges(draft, relationship.value),
    ids.request,
  );
}

/** The relationship a draft describes, once both endpoints resolve. */
function relationshipFor(
  policy: ConnectionPolicy,
  draft: ConnectionDraft,
  label: string,
  id: RelationshipId,
): Result<Relationship> {
  const endpoints = relationshipEndpoints(policy, draft);
  if (!endpoints.ok) {
    return endpoints;
  }
  return { ok: true, value: relationshipRecord(draft, label, endpoints.value, id) };
}

/** Source and target as Model addresses them, each member ID checked against its grammar. */
function relationshipEndpoints(
  policy: ConnectionPolicy,
  draft: ConnectionDraft,
): Result<RelationshipEndpoints> {
  const source = relationshipEndpoint(policy, draft.source);
  if (!source.ok) {
    return source;
  }
  const target = relationshipEndpoint(policy, draft.target);
  if (!target.ok) {
    return target;
  }
  return { ok: true, value: { source: source.value, target: target.value } };
}

/** The relationship record: labelled, solid, no provenance, cardinalities on associations only. */
function relationshipRecord(
  draft: ConnectionDraft,
  label: string,
  endpoints: RelationshipEndpoints,
  id: RelationshipId,
): Relationship {
  return {
    id,
    kind: draft.kind,
    label,
    source: endpoints.source,
    target: endpoints.target,
    ...associationCardinality(draft),
    style: 'solid',
    sources: [],
  };
}

/** Association ends; every other kind forbids cardinalities. */
function associationCardinality(draft: ConnectionDraft): Partial<Relationship> {
  if (draft.kind !== 'association') {
    return {};
  }
  return { ...cardinalityEntry('from', draft.from), ...cardinalityEntry('to', draft.to) };
}

/** One end's cardinality; `none` leaves the key out. */
function cardinalityEntry(
  side: 'from' | 'to',
  value: Cardinality,
): Partial<Relationship> {
  if (value === 'none') {
    return {};
  }
  return { [side]: value };
}

/** The relationship record and the section carrying its appearance. */
function relationshipChanges(
  draft: ConnectionDraft,
  relationship: Relationship,
): readonly Change[] {
  const section: Section = {
    ...draft.section,
    wires: [...draft.section.wires, connectionAppearance(relationship.id)],
  };
  return [
    { op: 'create', target: 'relationships', value: relationship },
    { op: 'replace', target: 'sections', value: section },
  ];
}

/** The wire appearance of a new relationship: orthogonal route, automatic sides, unlocked. */
function connectionAppearance(id: RelationshipId): Section['wires'][number] {
  return {
    relationship: id,
    route: 'orthogonal',
    sourceSide: 'auto',
    targetSide: 'auto',
    locked: false,
  };
}
