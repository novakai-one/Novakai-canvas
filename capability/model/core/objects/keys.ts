import type { DescendantId } from '../../contract/brands.js';
import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type { ContentBlock, Endpoint, Field, KeyGroup } from '../../contract/records/content.js';
import type { DiagramObject } from '../../contract/records/object.js';
import { duplicates } from '../invariants/duplicates.js';
import { diagnoseWhen, referenceIssue } from '../invariants/issues.js';

/**
 * Checks entity keys: scalar keys on `field` blocks, composite keys on `keygroup` blocks, and
 * every foreign-key reference. Nothing is inferred or written; every failure is collected.
 *
 * For each object, in order: at most one primary definition (a field or keygroup with
 * `key: 'primary'`), else `key` at `objects.<id>.content`, "At most one primary definition";
 * then each block in order:
 * - a field: only a foreign field may have `references` ("Only foreign fields have references"),
 *   and a foreign field needs one ("Foreign field requires reference"); its reference is then
 *   checked as a one-field foreign key;
 * - a keygroup: its field IDs must be unique (`duplicate`) and name fields of this object
 *   (`reference` at `<block path>.<field>`); then only a foreign keygroup may have `references`
 *   ("Nonforeign keygroup forbids references") and a foreign one needs them ("Foreign keygroup
 *   requires references"), checked as a foreign key over the fields it resolves, in order.
 *
 * A foreign key reports, in this order, all at the block path `objects.<id>.content.<block>`
 * unless noted:
 * 1. "Foreign key arity must match" when local and referenced field counts differ;
 * 2. "Composite foreign key targets one entity" when a reference's object differs from the ID of
 *    the object the first reference resolves to (so when that object is missing, any reference
 *    reports it, even a single one);
 * 3. `reference` at `<block path>.<member>` (or `.member` when absent) for each reference that is
 *    not a field of an entity;
 * 4. "Foreign references must match an ordered primary or unique key" unless the referenced
 *    fields, in order, equal a primary or unique key of the first reference's object;
 * 5. "Foreign field types must match target types" when a local field's target field is missing
 *    or its type differs (definition references compare by ID; plain string types compare as
 *    text).
 * All except item 3 are `key` diagnostics.
 *
 * Pure: Authoring owns correction, admission, commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateKeys(collection: Collection): readonly Diagnostic[] {
  return collection.objects.flatMap(
    /** Checks one object's keys. */
    (object) => validateObjectKeys(object, collection),
  );
}

/** A key: its field IDs, in declared order. */
type OrderedKey = readonly DescendantId[];

/** Returns an object's `field` blocks, in order. */
function entityFields(object: DiagramObject): readonly Field[] {
  return object.content.filter(
    /** Tells whether the block is a field. */
    (block): block is Field => block.kind === 'field',
  );
}

/** Finds a field block by ID. A missing ID, or one naming another kind of block, finds nothing. */
function findField(
  object: DiagramObject,
  memberId: DescendantId | undefined,
): Field | undefined {
  return entityFields(object).find(
    /** Tells whether this is the field. */
    (field) => field.id === memberId,
  );
}

/**
 * Returns an object's candidate keys: each primary or unique field as a one-field key, then each
 * keygroup that is not foreign. Foreign definitions are not candidate keys.
 */
function candidateKeys(object: DiagramObject): readonly OrderedKey[] {
  const scalarKeys = entityFields(object).filter(
    /** Tells whether the field is a primary or unique key. */
    (field) => field.key === 'primary' || field.key === 'unique',
  );
  const keyGroups = object.content.filter(
    /** Tells whether the block is a keygroup. */
    (block): block is KeyGroup => block.kind === 'keygroup',
  );
  const compositeKeys = keyGroups.filter(
    /** Tells whether the keygroup is not foreign. */
    (group) => group.key !== 'foreign',
  );
  const scalarKeyFields = scalarKeys.map(
    /** A one-field key. */
    (field) => [field.id],
  );
  const compositeKeyFields = compositeKeys.map(
    /** The keygroup's fields. */
    (group) => group.fields,
  );
  return [...scalarKeyFields, ...compositeKeyFields];
}

/** Returns a target's candidate keys; a missing target has none (its reference is reported). */
function targetKeys(object: DiagramObject | undefined): readonly OrderedKey[] {
  if (object === undefined) {
    return [];
  }
  return candidateKeys(object);
}

/** Resolves a foreign reference to a field of an entity; ports and other object kinds do not. */
function resolveForeignField(
  endpoint: Endpoint,
  collection: Collection,
): Field | undefined {
  const object = collection.objects.find(
    /** Tells whether this is the referenced object. */
    (candidate) => candidate.id === endpoint.object,
  );
  if (object?.kind !== 'entity') {
    return undefined;
  }
  return findField(object, endpoint.member);
}

/** Tells whether the references name exactly the key's fields, in the same order. */
function matchesOrderedKey(
  key: OrderedKey,
  references: readonly Endpoint[],
): boolean {
  if (key.length !== references.length) {
    return false;
  }
  return key.every(
    /** Tells whether the reference at this position names this key field. */
    (fieldId, index) => fieldId === references[index]?.member,
  );
}

/** Reports every reference that did not resolve, so one missing target does not hide others. */
function missingForeignFields(
  references: readonly Endpoint[],
  resolved: readonly (Field | undefined)[],
  path: string,
): readonly Diagnostic[] {
  return references.flatMap(
    /** Reports this reference if it did not resolve. */
    (endpoint, index) => {
      const memberPath = endpoint.member ?? 'member';
      return referenceIssue(resolved[index] === undefined, `${path}.${memberPath}`);
    },
  );
}

/**
 * Checks one foreign key: arity, a single target entity, resolved references, an ordered match
 * with a candidate key, then matching field types. Each check reports independently.
 */
function validateForeignKey(
  localFields: readonly Field[],
  references: readonly Endpoint[],
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  const firstReference = references[0];
  const target = collection.objects.find(
    /** Tells whether this is the first reference's object. */
    (object) => object.id === firstReference?.object,
  );
  const resolvedFields = references.map(
    /** Resolves one reference to a target field. */
    (endpoint) => resolveForeignField(endpoint, collection),
  );
  const arityIssues = diagnoseWhen(
    localFields.length !== references.length,
    'key',
    path,
    'Foreign key arity must match',
  );
  const spansEntities = references.some(
    /** Tells whether this reference names a different object from the first. */
    (endpoint) => endpoint.object !== target?.id,
  );
  const entityIssues = diagnoseWhen(
    spansEntities,
    'key',
    path,
    'Composite foreign key targets one entity',
  );
  const referenceIssues = missingForeignFields(references, resolvedFields, path);
  const matchesCandidateKey = targetKeys(target).some(
    /** Tells whether the references match this candidate key. */
    (key) => matchesOrderedKey(key, references),
  );
  const keyIssues = diagnoseWhen(
    !matchesCandidateKey,
    'key',
    path,
    'Foreign references must match an ordered primary or unique key',
  );
  const typesDiffer = localFields.some(
    /** Tells whether this local field's type differs from its target's. */
    (field, index) => !sameFieldType(field, resolvedFields[index]),
  );
  const typeIssues = diagnoseWhen(
    typesDiffer,
    'key',
    path,
    'Foreign field types must match target types',
  );
  return [...arityIssues, ...entityIssues, ...referenceIssues, ...keyIssues, ...typeIssues];
}

/**
 * Tells whether two fields have the same type. Definition references compare by ID; when either
 * type is a plain string, the two must be equal. A missing target never matches.
 */
function sameFieldType(
  left: Field,
  right: Field | undefined,
): boolean {
  if (right === undefined) {
    return false;
  }
  if (typeof left.type === 'string' || typeof right.type === 'string') {
    return left.type === right.type;
  }
  return left.type.id === right.type.id;
}

/** Checks a field's key: only a foreign field has a reference, and it must have one. */
function validateFieldKey(
  field: Field,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (field.key !== 'foreign') {
    return diagnoseWhen(
      field.references !== undefined,
      'key',
      path,
      'Only foreign fields have references',
    );
  }
  if (field.references === undefined) {
    return diagnoseWhen(true, 'key', path, 'Foreign field requires reference');
  }
  return validateForeignKey([field], [field.references], collection, path);
}

/**
 * Checks a keygroup's references: only a foreign keygroup has them, and it must. The foreign key
 * uses the group's fields that resolve, in declared order (missing ones are reported elsewhere).
 */
function validateGroupReferences(
  group: KeyGroup,
  object: DiagramObject,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (group.key !== 'foreign') {
    return diagnoseWhen(
      group.references !== undefined,
      'key',
      path,
      'Nonforeign keygroup forbids references',
    );
  }
  if (group.references === undefined) {
    return diagnoseWhen(true, 'key', path, 'Foreign keygroup requires references');
  }
  const fields = group.fields
    .map(
      /** Finds the named field. */
      (id) => findField(object, id),
    )
    .filter(
      /** Keeps fields that exist. */
      (field) => field !== undefined,
    );
  return validateForeignKey(fields, group.references, collection, path);
}

/** Checks a keygroup: unique field IDs, fields that exist, then its references. */
function validateKeyGroup(
  group: KeyGroup,
  object: DiagramObject,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  const duplicateFields = duplicates(
    group.fields,
    /** A field ID is its own key. */
    (id) => id,
    path,
  );
  const unresolvedFields = group.fields.flatMap(
    /** Reports a field ID with no matching field. */
    (id) => referenceIssue(findField(object, id) === undefined, `${path}.${id}`),
  );
  const referenceIssues = validateGroupReferences(group, object, collection, path);
  return [...duplicateFields, ...unresolvedFields, ...referenceIssues];
}

/** Checks one block's key: fields and keygroups are checked; other blocks give nothing. */
function validateBlockKey(
  block: ContentBlock,
  object: DiagramObject,
  collection: Collection,
): readonly Diagnostic[] {
  const path = `objects.${object.id}.content.${block.id}`;
  if (block.kind === 'field') {
    return validateFieldKey(block, collection, path);
  }
  if (block.kind === 'keygroup') {
    return validateKeyGroup(block, object, collection, path);
  }
  return [];
}

/** Checks one object: at most one primary definition, then every block's key. */
function validateObjectKeys(
  object: DiagramObject,
  collection: Collection,
): readonly Diagnostic[] {
  const primaryDefinitions = object.content.filter(
    /** Tells whether the block is a primary key definition. */
    (block) => 'key' in block && block.key === 'primary',
  );
  const primaryIssues = diagnoseWhen(
    primaryDefinitions.length > 1,
    'key',
    `objects.${object.id}.content`,
    'At most one primary definition',
  );
  const blockIssues = object.content.flatMap(
    /** Checks one block's key. */
    (block) => validateBlockKey(block, object, collection),
  );
  return [...primaryIssues, ...blockIssues];
}
