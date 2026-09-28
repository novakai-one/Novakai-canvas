import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type { Endpoint } from '../../contract/records/content.js';
import type { DiagramObject, ObjectKind } from '../../contract/records/object.js';
import type { Relationship } from '../../contract/records/relationship.js';
import {
  memberEndpoints,
  genericMemberEndpoints,
  sourceEndpoints,
  targetEndpoints,
} from '../../contract/records/policies.js';
import { descendants, type ObjectDescendant } from '../objects/content.js';
import { resolveCallableEndpoint } from './callable.js';
import { diagnoseWhen, referenceIssue } from '../invariants/issues.js';

/**
 * Checks every relationship's endpoints and cardinalities, in relationship order. Every failure
 * is collected. For each relationship, in this order:
 * 1. its source, then its target (path `relationships.<id>.source` or `.target`):
 *    - the object must exist: `reference`;
 *    - a named `member` must be a descendant whose kind the owner allows (`memberEndpoints`,
 *      else `genericMemberEndpoints`): `endpoint` at `<path>.member`, "Endpoint must address a
 *      legal field/member/signature/port/row";
 *    - the object's kind must be allowed for that end of the relationship kind
 *      (`sourceEndpoints` / `targetEndpoints`; no entry allows any): `endpoint`, "Object kind is
 *      incompatible with relationship kind";
 * 2. for `calls`, the target must resolve with `resolveCallableEndpoint`, else `endpoint`: at
 *    `<target>`, "Calls target must address a signature or whole function" when it has no
 *    member; at `<target>.member`, "Calls target must resolve to a signature" when it has one;
 * 3. an `association` needs both `from` and `to` ("Association requires both cardinalities");
 *    any other kind must have neither ("Cardinalities are only valid for associations"), both
 *    `endpoint` at `relationships.<id>`.
 *
 * Wire routes and foreign-key inference are not checked here. Pure: Authoring owns correction,
 * admission, commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateRelationships(collection: Collection): readonly Diagnostic[] {
  return collection.relationships.flatMap(
    /** Checks one relationship. */
    (relationship) => validateRelationship(relationship, collection),
  );
}

/**
 * Tells whether a member exists and its kind is one the owner kind allows. A missing member is
 * never allowed.
 */
function isAllowedMember(
  member: ObjectDescendant | undefined,
  ownerKind: ObjectKind,
): boolean {
  if (member === undefined) {
    return false;
  }
  const allowed: readonly ObjectDescendant['kind'][] =
    memberEndpoints[ownerKind] ?? genericMemberEndpoints;
  return allowed.includes(member.kind);
}

/** Finds the endpoint's object; a missing one is reported by the endpoint check. */
function resolveEndpoint(
  endpoint: Endpoint,
  collection: Collection,
): DiagramObject | undefined {
  return collection.objects.find(
    /** Tells whether this is the endpoint's object. */
    (object) => object.id === endpoint.object,
  );
}

/**
 * Checks an endpoint's named member. No member (the whole object) and a missing object give no
 * diagnostic here.
 */
function validateMember(
  endpoint: Endpoint,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (endpoint.member === undefined) {
    return [];
  }
  const object = resolveEndpoint(endpoint, collection);
  if (object === undefined) {
    return [];
  }
  const member = descendants(object).find(
    /** Tells whether this is the named member. */
    (item) => item.id === endpoint.member,
  );
  return diagnoseWhen(
    !isAllowedMember(member, object.kind),
    'endpoint',
    `${path}.member`,
    'Endpoint must address a legal field/member/signature/port/row',
  );
}

/**
 * Checks the object's kind against the allowed kinds. No policy entry, or a missing object, gives
 * no diagnostic here.
 */
function validateObjectKind(
  object: DiagramObject | undefined,
  allowed: readonly ObjectKind[] | undefined,
  path: string,
): readonly Diagnostic[] {
  if (allowed === undefined) {
    return [];
  }
  if (object === undefined) {
    return [];
  }
  return diagnoseWhen(
    !allowed.includes(object.kind),
    'endpoint',
    path,
    'Object kind is incompatible with relationship kind',
  );
}

/** Checks one endpoint: the object exists, its member is addressable, then its kind is allowed. */
function validateEndpoint(
  endpoint: Endpoint,
  collection: Collection,
  path: string,
  allowedKinds: readonly ObjectKind[] | undefined,
): readonly Diagnostic[] {
  const object = resolveEndpoint(endpoint, collection);
  const referenceIssues = referenceIssue(object === undefined, path);
  const memberIssues = validateMember(endpoint, collection, path);
  const kindIssues = validateObjectKind(object, allowedKinds, path);
  return [...referenceIssues, ...memberIssues, ...kindIssues];
}

/** Checks cardinalities: an association needs both; every other kind must have none. */
function validateCardinalities(
  relationship: Relationship,
  path: string,
): readonly Diagnostic[] {
  if (relationship.kind === 'association') {
    const missingCardinality = relationship.from === undefined || relationship.to === undefined;
    return diagnoseWhen(
      missingCardinality,
      'endpoint',
      path,
      'Association requires both cardinalities',
    );
  }
  const hasCardinality = relationship.from !== undefined || relationship.to !== undefined;
  return diagnoseWhen(
    hasCardinality,
    'endpoint',
    path,
    'Cardinalities are only valid for associations',
  );
}

/**
 * Checks one relationship: source, target, the callable target of a `calls` relationship, then
 * cardinalities. Source and target have separate kind policies.
 */
function validateRelationship(
  relationship: Relationship,
  collection: Collection,
): readonly Diagnostic[] {
  const path = `relationships.${relationship.id}`;
  const sourceIssues = validateEndpoint(
    relationship.source,
    collection,
    `${path}.source`,
    sourceEndpoints[relationship.kind],
  );
  const targetIssues = validateEndpoint(
    relationship.target,
    collection,
    `${path}.target`,
    targetEndpoints[relationship.kind],
  );
  const callableIssues = validateCallsTarget(relationship, collection, `${path}.target`);
  const cardinalityIssues = validateCardinalities(relationship, path);
  return [...sourceIssues, ...targetIssues, ...callableIssues, ...cardinalityIssues];
}

/** Checks the target of a `calls` relationship; other kinds give nothing. */
function validateCallsTarget(
  relationship: Relationship,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (relationship.kind !== 'calls') {
    return [];
  }
  return validateCallableTarget(relationship.target, collection, path);
}

/**
 * Reports a `calls` target that is not callable: at the target path when it has no member, at
 * its `member` path when it names one.
 */
function validateCallableTarget(
  endpoint: Endpoint,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (resolveCallableEndpoint(collection, endpoint) !== undefined) {
    return [];
  }
  if (endpoint.member === undefined) {
    return [
      {
        code: 'endpoint',
        path,
        message: 'Calls target must address a signature or whole function',
      },
    ];
  }
  return [
    {
      code: 'endpoint',
      path: `${path}.member`,
      message: 'Calls target must resolve to a signature',
    },
  ];
}
