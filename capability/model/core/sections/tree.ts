import type { ObjectId } from '../../contract/brands.js';
import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type { Relationship } from '../../contract/records/relationship.js';
import type { Section } from '../../contract/records/section.js';
import { diagnoseWhen } from '../invariants/issues.js';
import { hasCycle, visibleObjects } from './groups.js';
import { visibleRelationships } from './modes.js';
import { sectionPath } from './paths.js';

/**
 * Checks a `tree` section's parent graph; other modes give nothing. Layout and annotation
 * placement are not checked here.
 *
 * Participants are the visible objects (in `visibleObjects` order) whose appearance says
 * `participation: 'tree'`, or, without a participation, every one that is not a `note` object
 * (including a visible ID with no object in the collection).
 * Parent edges are the drawn `parent` relationships. Every failure is a `tree` diagnostic,
 * collected in this order:
 * 1. the root, at `sections.<id>.root`: with no participants there must be no root ("Empty tree
 *    has no root"); otherwise the root must be a participant ("Tree root must be an explicit
 *    participant");
 * 2. each parent edge must connect two participants, at `sections.<id>.wires.<relationship>`,
 *    "Parent edge must connect tree participants";
 * 3. the root must have no parent and every other participant exactly one, at
 *    `sections.<id>.appearances.<object>`, "Root has zero parents; every other participant
 *    exactly one";
 * 4. following first parents from each participant must not repeat an object, at
 *    `sections.<id>.appearances.<object>`, "Parent graph must be acyclic and rooted".
 *
 * Pure: Authoring owns correction, commit and crash recovery.
 *
 * @param section - A parsed section.
 * @param collection - The collection the section belongs to.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for parsed data.
 */
export function validateTree(
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  if (section.mode !== 'tree') {
    return [];
  }
  const participants = visibleObjects(section).filter(
    /** Tells whether the object takes part in the tree. */
    (id) => participatesInTree(id, section, collection),
  );
  const parents = visibleRelationships(section, collection).filter(
    /** Tells whether the relationship is a parent edge. */
    (wire) => wire.kind === 'parent',
  );
  const rootIssues = validateRoot(participants, section);
  const edgeIssues = parents.flatMap(
    /** Checks one parent edge's endpoints. */
    (wire) => validateParentEdge(wire, participants, section),
  );
  const countIssues = participants.flatMap(
    /** Checks one participant's parent count. */
    (id) => validateParentCount(id, parents, section),
  );
  const cycleIssues = participants.flatMap(
    /** Checks one participant's parent chain. */
    (id) => validateAncestry(id, parents, section),
  );
  return [...rootIssues, ...edgeIssues, ...countIssues, ...cycleIssues];
}

/**
 * Tells whether an object takes part in the tree. An explicit participation decides; without
 * one, notes are annotations and every other object (or a missing one) takes part.
 */
function participatesInTree(
  id: ObjectId,
  section: Section,
  collection: Collection,
): boolean {
  const appearance = section.appearances.find(
    /** Tells whether this appearance shows the object. */
    (candidate) => candidate.object === id,
  );
  if (appearance?.participation !== undefined) {
    return appearance.participation === 'tree';
  }
  const object = collection.objects.find(
    /** Tells whether this is the object. */
    (candidate) => candidate.id === id,
  );
  return object?.kind !== 'note';
}

/** Checks the root: none for an empty tree, otherwise one of the participants. */
function validateRoot(
  participants: readonly ObjectId[],
  section: Section,
): readonly Diagnostic[] {
  const path = `${sectionPath(section)}.root`;
  if (participants.length === 0) {
    return diagnoseWhen(section.root !== undefined, 'tree', path, 'Empty tree has no root');
  }
  const rootIsParticipant = participants.some(
    /** Tells whether this participant is the root. */
    (id) => id === section.root,
  );
  return diagnoseWhen(
    !rootIsParticipant,
    'tree',
    path,
    'Tree root must be an explicit participant',
  );
}

/** Reports a parent edge unless both ends are participants (annotations cannot be in the tree). */
function validateParentEdge(
  wire: Relationship,
  participants: readonly ObjectId[],
  section: Section,
): readonly Diagnostic[] {
  const sourceParticipates = participants.includes(wire.source.object);
  const targetParticipates = participants.includes(wire.target.object);
  return diagnoseWhen(
    !sourceParticipates || !targetParticipates,
    'tree',
    `${sectionPath(section)}.wires.${wire.id}`,
    'Parent edge must connect tree participants',
  );
}

/** Returns how many parents an object should have: none for the root, one otherwise. */
function expectedParentCount(
  id: ObjectId,
  section: Section,
): number {
  if (id === section.root) {
    return 0;
  }
  return 1;
}

/** Tells whether a parent edge points at the object (the child end). */
function pointsAt(
  wire: Relationship,
  id: ObjectId,
): boolean {
  return wire.target.object === id;
}

/** Returns the source of the first parent edge into an object, if any. */
function firstParent(
  id: ObjectId,
  parents: readonly Relationship[],
): ObjectId | undefined {
  const edge = parents.find(
    /** Tells whether the edge points at the object. */
    (wire) => pointsAt(wire, id),
  );
  return edge?.source.object;
}

/** Reports a participant whose number of parent edges differs from the expected count. */
function validateParentCount(
  id: ObjectId,
  parents: readonly Relationship[],
  section: Section,
): readonly Diagnostic[] {
  const incoming = parents.filter(
    /** Tells whether the edge points at the object. */
    (wire) => pointsAt(wire, id),
  );
  const actualCount = incoming.length;
  return diagnoseWhen(
    actualCount !== expectedParentCount(id, section),
    'tree',
    `${sectionPath(section)}.appearances.${id}`,
    'Root has zero parents; every other participant exactly one',
  );
}

/**
 * Reports a participant whose first-parent chain repeats an object. With the counts checked,
 * this means every participant reaches the root.
 */
function validateAncestry(
  id: ObjectId,
  parents: readonly Relationship[],
  section: Section,
): readonly Diagnostic[] {
  const cycleExists = hasCycle(
    id,
    /** The object's first parent. */
    (current) => firstParent(current, parents),
  );
  return diagnoseWhen(
    cycleExists,
    'tree',
    `${sectionPath(section)}.appearances.${id}`,
    'Parent graph must be acyclic and rooted',
  );
}
