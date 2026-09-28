import type { DescendantId, ObjectId } from '../../contract/brands.js';
import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type { DiagramObject } from '../../contract/records/object.js';
import type { Section, SequenceItem } from '../../contract/records/section.js';
import { duplicates } from '../invariants/duplicates.js';
import { diagnoseWhen, referenceIssue } from '../invariants/issues.js';
import { hasCycle, visibleObjects } from './groups.js';
import { resolveCallableEndpoint } from '../relationships/callable.js';
import { sectionPath } from './paths.js';

/**
 * Checks a `sequence` section's items; other modes give nothing. Events stay ordered records;
 * they are not routed wires. Every failure is collected, in this order (`<seq>` is
 * `sections.<id>.sequence`):
 * 1. the section must have no wires: `sequence` at `<seq>`, "Sequence uses ordered events, not
 *    wire appearances";
 * 2. item and branch IDs share one namespace and must be unique: `duplicate` at `<seq>.<id>`;
 * 3. `order` must be unique among siblings (same parent and branch): `duplicate` at
 *    `<seq>.order.<parent>:<branch>:<order>`;
 * 4. for each item, at `<seq>.<item>`, all `sequence` diagnostics unless noted:
 *    - a fragment: `alt` needs at least two branches and `opt`/`loop` none ("alt needs at least
 *      two branches; opt/loop forbid branches"); branch labels unique (`duplicate` at
 *      `<item path>.branches.<label>`);
 *    - its parent: a root item has no `branch` ("Root item has no branch"); a named parent must
 *      exist and be a fragment ("Parent must resolve to a fragment"); a child of `alt` must name one of its
 *      branches ("Child must name an owning alt branch"), a child of any other fragment none
 *      ("Only alt children identify a branch");
 *    - an event: its source and target must each be a visible `participant`, or a visible
 *      `module` appearing directly at the section's top level (at `<item path>.<object>`, "Event
 *      endpoint must be a visible participant or direct top-level module"); then its operation
 *      (see below);
 *    - the parent chain must not repeat an item ("Fragment containment must be acyclic").
 *
 * An event's `operation`, at `<item path>.operation`, stops at its first failure: not allowed on
 * a `return` event ("Return
 * events cannot reference an operation"); its object must be the event's target ("Operation owner
 * must equal the event target"); that object must exist (`reference`); and it must resolve with
 * `resolveCallableEndpoint`, else "Operation must address a canonical function or signature"
 * (no member) or, at `.member`, "Operation must resolve to a signature".
 *
 * Pure: Authoring owns correction, commit and crash recovery.
 *
 * @param section - A parsed section.
 * @param collection - The collection the section belongs to.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for parsed data.
 */
export function validateSequence(
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  if (section.mode !== 'sequence') {
    return [];
  }
  const path = `${sectionPath(section)}.sequence`;
  const wireIssues = diagnoseWhen(
    section.wires.length > 0,
    'sequence',
    path,
    'Sequence uses ordered events, not wire appearances',
  );
  const identityIssues = duplicates(
    section.sequence.flatMap(itemIdentities),
    /** An ID is its own key. */
    (id) => id,
    path,
  );
  const orderIssues = duplicates(section.sequence, siblingOrderKey, `${path}.order`);
  const itemIssues = section.sequence.flatMap(
    /** Checks one item at its own path. */
    (item) => validateSequenceItem(item, section, collection, `${path}.${item.id}`),
  );
  return [...wireIssues, ...identityIssues, ...orderIssues, ...itemIssues];
}

/** A control fragment item. */
type Fragment = Extract<SequenceItem, { kind: 'fragment' }>;

/** A message event item. */
type SequenceEvent = Extract<SequenceItem, { kind: 'event' }>;

/** The operation an event names. */
type Operation = NonNullable<SequenceEvent['operation']>;

/** Returns an item's IDs: its own, then (for a fragment) each branch's. */
function itemIdentities(item: SequenceItem): readonly DescendantId[] {
  if (item.kind === 'event') {
    return [item.id];
  }
  const ownId = item.id;
  const branchIds = item.branches.map(
    /** The branch's ID. */
    (branch) => branch.id,
  );
  return [ownId, ...branchIds];
}

/** Tells whether a fragment's branch count fits its operator: `alt` two or more, others none. */
function hasValidBranchCount(fragment: Fragment): boolean {
  if (fragment.operator === 'alt') {
    return fragment.branches.length >= 2;
  }
  return fragment.branches.length === 0;
}

/** Checks a fragment's branch count, then that its branch labels are unique. Events give nothing. */
function validateFragment(
  item: SequenceItem,
  path: string,
): readonly Diagnostic[] {
  if (item.kind !== 'fragment') {
    return [];
  }
  const countIssues = diagnoseWhen(
    !hasValidBranchCount(item),
    'sequence',
    path,
    'alt needs at least two branches; opt/loop forbid branches',
  );
  const labelIssues = duplicates(
    item.branches,
    /** A branch's key is its label. */
    (branch) => branch.label,
    `${path}.branches`,
  );
  return [...countIssues, ...labelIssues];
}

/**
 * Checks an item's `branch` against its parent fragment: a child of `alt` must name one of its
 * branches; a child of another fragment must name none.
 */
function validateBranchMembership(
  item: SequenceItem,
  owner: Fragment,
  path: string,
): readonly Diagnostic[] {
  if (owner.operator !== 'alt') {
    return diagnoseWhen(
      item.branch !== undefined,
      'sequence',
      path,
      'Only alt children identify a branch',
    );
  }
  const branchExists = owner.branches.some(
    /** Tells whether this is the named branch. */
    (branch) => branch.id === item.branch,
  );
  return diagnoseWhen(!branchExists, 'sequence', path, 'Child must name an owning alt branch');
}

/**
 * Checks an item's parent: a root item (no parent) has no branch; a named parent must be a
 * fragment, then the branch is checked against it.
 */
function validateParent(
  item: SequenceItem,
  section: Section,
  path: string,
): readonly Diagnostic[] {
  if (item.parent === undefined) {
    return diagnoseWhen(item.branch !== undefined, 'sequence', path, 'Root item has no branch');
  }
  const owner = section.sequence.find(
    /** Tells whether this is the parent item. */
    (candidate) => candidate.id === item.parent,
  );
  if (owner?.kind !== 'fragment') {
    return sequenceDiagnostic(path, 'Parent must resolve to a fragment');
  }
  return validateBranchMembership(item, owner, path);
}

/**
 * Tells whether an event endpoint is a visible participant, or a visible module appearing
 * directly at the section's top level.
 */
function isVisibleParticipant(
  id: ObjectId,
  section: Section,
  collection: Collection,
): boolean {
  const object = collection.objects.find(
    /** Tells whether this is the endpoint object. */
    (candidate) => candidate.id === id,
  );
  if (!visibleObjects(section).includes(id)) {
    return false;
  }
  return canParticipate(object, id, section);
}

/**
 * Tells whether an object can be an event endpoint: a `participant` always; a `module` only when
 * it appears directly at the section's top level; anything else (or a missing object) never.
 */
function canParticipate(
  object: DiagramObject | undefined,
  id: ObjectId,
  section: Section,
): boolean {
  if (object === undefined) {
    return false;
  }
  switch (object.kind) {
    case 'participant':
      return true;
    case 'module':
      return directAppearance(id, section);
    default:
      return false;
  }
}

/** Tells whether the object has an ordinary appearance outside any group. */
function directAppearance(
  id: ObjectId,
  section: Section,
): boolean {
  return section.appearances.some(
    /** Tells whether this appearance shows the object at top level. */
    (appearance) => appearance.object === id && appearance.group === undefined,
  );
}

/** Checks an event's source and target, then its operation. Fragments give nothing. */
function validateEvent(
  item: SequenceItem,
  section: Section,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (item.kind !== 'event') {
    return [];
  }
  const endpointIssues = [item.source, item.target].flatMap(
    /** Checks one endpoint. */
    (id) =>
      diagnoseWhen(
        !isVisibleParticipant(id, section, collection),
        'sequence',
        `${path}.${id}`,
        'Event endpoint must be a visible participant or direct top-level module',
      ),
  );
  const operationIssues = validateOperation(item, collection, path);
  return [...endpointIssues, ...operationIssues];
}

/** Checks an event's operation, if any: never on a `return` event, then its target. */
function validateOperation(
  item: SequenceEvent,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (item.operation === undefined) {
    return [];
  }
  const operation = item.operation;
  const operationPath = `${path}.operation`;
  if (item.message === 'return') {
    return sequenceDiagnostic(operationPath, 'Return events cannot reference an operation');
  }
  return validateOperationTarget(item, operation, collection, operationPath);
}

/**
 * Checks an operation's object: it must be the event's target, must exist, and must be
 * callable.
 */
function validateOperationTarget(
  item: SequenceEvent,
  operation: Operation,
  collection: Collection,
  operationPath: string,
): readonly Diagnostic[] {
  if (operation.object !== item.target) {
    return sequenceDiagnostic(operationPath, 'Operation owner must equal the event target');
  }
  const owner = collection.objects.find(
    /** Tells whether this is the operation's object. */
    (object) => object.id === operation.object,
  );
  if (owner === undefined) {
    return referenceIssue(true, operationPath);
  }
  return validateCallableOperation(collection, operation, operationPath);
}

/** Reports an operation that does not resolve to a callable target. */
function validateCallableOperation(
  collection: Collection,
  operation: Operation,
  operationPath: string,
): readonly Diagnostic[] {
  if (resolveCallableEndpoint(collection, operation) !== undefined) {
    return [];
  }
  return invalidOperation(operation, operationPath);
}

/** Builds one `sequence` diagnostic. */
function sequenceDiagnostic(
  path: string,
  message: string,
): readonly Diagnostic[] {
  return [{ code: 'sequence', path, message }];
}

/**
 * Builds the diagnostic for an operation that is not callable: at the operation path without a
 * member, at its `member` path with one.
 */
function invalidOperation(
  operation: Operation,
  operationPath: string,
): readonly Diagnostic[] {
  if (operation.member === undefined) {
    return sequenceDiagnostic(
      operationPath,
      'Operation must address a canonical function or signature',
    );
  }
  return sequenceDiagnostic(`${operationPath}.member`, 'Operation must resolve to a signature');
}

/** Returns an item's parent ID; a missing item, or a root item, has none. */
function parentId(
  id: DescendantId,
  section: Section,
): DescendantId | undefined {
  const item = section.sequence.find(
    /** Tells whether this is the item. */
    (candidate) => candidate.id === id,
  );
  return item?.parent;
}

/** Checks one item: fragment rules, parent, event rules, then its parent chain for a cycle. */
function validateSequenceItem(
  item: SequenceItem,
  section: Section,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  const fragmentIssues = validateFragment(item, path);
  const parentIssues = validateParent(item, section, path);
  const eventIssues = validateEvent(item, section, collection, path);
  const cycleExists = hasCycle(
    item.id,
    /** The item's parent. */
    (id) => parentId(id, section),
  );
  const cycleIssues = diagnoseWhen(
    cycleExists,
    'sequence',
    path,
    'Fragment containment must be acyclic',
  );
  return [...fragmentIssues, ...parentIssues, ...eventIssues, ...cycleIssues];
}

/** Returns an item's sibling-order key: parent, branch and order (unique among siblings). */
function siblingOrderKey(item: SequenceItem): string {
  const parentScope = item.parent ?? '';
  const branchScope = item.branch ?? '';
  return `${parentScope}:${branchScope}:${item.order}`;
}
