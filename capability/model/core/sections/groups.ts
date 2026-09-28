import type { GroupId, ObjectId } from '../../contract/brands.js';
import type { Diagnostic } from '../../contract/errors.js';
import type { Section, Group } from '../../contract/records/section.js';
import { diagnoseWhen, referenceIssue } from '../invariants/issues.js';
import { duplicates } from '../invariants/duplicates.js';
import { sectionPath } from './paths.js';

/**
 * Lists the object IDs a section shows: each ordinary appearance's object, in order, then each
 * group's represented object (groups without one are skipped). Duplicates are kept so validators
 * can report them.
 *
 * @param section - A parsed section.
 * @returns A new list of object IDs.
 * @throws Never for a parsed section.
 */
export function visibleObjects(section: Section): readonly ObjectId[] {
  const ordinaryObjects = section.appearances.map(
    /** The appearance's object. */
    (appearance) => appearance.object,
  );
  const representedObjects = section.groups
    .map(
      /** The group's represented object, if any. */
      (group) => group.represents,
    )
    .filter(
      /** Keeps groups that represent an object. */
      (id) => id !== undefined,
    );
  return [...ordinaryObjects, ...representedObjects];
}

/**
 * Tells whether following parent links from `start` ever reaches an ID already visited. The walk
 * stops at a missing parent (no cycle). The repeated ID need not be `start` itself: a cycle
 * further up the chain also counts. Iterative, so a long chain cannot exhaust the stack.
 *
 * @param start - The ID to start from.
 * @param parentOf - Returns an ID's parent, or `undefined` at the top. Called once per visited ID.
 * @returns `true` when the chain repeats an ID.
 * @throws Whatever `parentOf` throws; it is not caught here. The validators that call it run
 * inside `validate`'s `safelyValidateShape`, which turns a throw into `shape` at `$`.
 */
export function hasCycle<Id extends string>(
  start: Id,
  parentOf: (id: Id) => Id | undefined,
): boolean {
  return traceAncestors(start, parentOf).hasCycle;
}

/**
 * Tells whether a group membership is inside `ownerId`: true when `parentId` is the owner, or
 * reaches it through parent groups. An absent `parentId` (top level) is never inside.
 *
 * @param parentId - The group an item belongs to, if any.
 * @param ownerId - The group to look for.
 * @param section - The section whose groups define the parent links.
 * @returns Whether the owner is on the parent chain.
 * @throws Never for a parsed section.
 */
export function nestedIn(
  parentId: GroupId | undefined,
  ownerId: GroupId,
  section: Section,
): boolean {
  const ancestry = traceAncestors(
    parentId,
    /** The group's parent in this section. */
    (id) => parentGroup(id, section),
  );
  return ancestry.visited.has(ownerId);
}

/**
 * Checks one section's groups, in this order:
 * 1. group IDs must be unique: `duplicate` at `sections.<id>.groups.<group>`;
 * 2. each object may be shown once, by an appearance or a representing group: `duplicate` at
 *    `sections.<id>.appearances.<object>`;
 * 3. each appearance's `group` must exist: `reference` at
 *    `sections.<id>.appearances.<object>.group`;
 * 4. for each group: its `parent` must exist (`reference` at `...groups.<group>.parent`), and its
 *    parent chain must not repeat a group (`group` at `...groups.<group>`, "Group parent graph
 *    must be acyclic").
 * An omitted `group` or `parent` means top level. Every failure is collected. Pure: Authoring
 * owns correction, commit and crash recovery.
 *
 * @param section - A parsed section.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed section.
 */
export function validateGroups(section: Section): readonly Diagnostic[] {
  const path = sectionPath(section);
  const groupIdentities = duplicates(
    section.groups,
    /** A group's key is its ID. */
    (group) => group.id,
    `${path}.groups`,
  );
  const appearanceIdentities = duplicates(
    visibleObjects(section),
    /** An object ID is its own key. */
    (id) => id,
    `${path}.appearances`,
  );
  const memberships = section.appearances.flatMap(
    /** Checks one appearance's group. */
    (appearance) =>
      validateParentReference(
        appearance.group,
        section,
        `${path}.appearances.${appearance.object}.group`,
      ),
  );
  const ancestry = section.groups.flatMap(
    /** Checks one group's parent and parent chain. */
    (group) => validateGroupAncestry(group, section, `${path}.groups.${group.id}`),
  );
  return [...groupIdentities, ...appearanceIdentities, ...memberships, ...ancestry];
}

/** The result of walking a parent chain. */
interface Ancestry<Id extends string> {
  /** Every ID visited, starting ID included. */
  readonly visited: ReadonlySet<Id>;
  /** Whether the walk stopped at an ID already visited. */
  readonly hasCycle: boolean;
}

/** Tells whether the walk can continue: the ID exists and was not visited yet. */
function canVisit<Id extends string>(
  id: Id | undefined,
  visited: ReadonlySet<Id>,
): id is Id {
  return id !== undefined && !visited.has(id);
}

/**
 * Walks parent links from `start` until a missing parent or a repeated ID. The set and cursor
 * are local; no record is changed.
 */
function traceAncestors<Id extends string>(
  start: Id | undefined,
  parentOf: (id: Id) => Id | undefined,
): Ancestry<Id> {
  const visited = new Set<Id>();
  let current = start;
  while (canVisit(current, visited)) {
    visited.add(current);
    current = parentOf(current);
  }
  return { visited, hasCycle: current !== undefined };
}

/** Returns a group's parent; a missing group, or one at top level, has none. */
function parentGroup(
  id: GroupId,
  section: Section,
): GroupId | undefined {
  const group = section.groups.find(
    /** Tells whether this is the group. */
    (candidate) => candidate.id === id,
  );
  return group?.parent;
}

/** Checks that a named parent group exists. No parent (top level) gives nothing. */
function validateParentReference(
  parentId: GroupId | undefined,
  section: Section,
  path: string,
): readonly Diagnostic[] {
  if (parentId === undefined) {
    return [];
  }
  const parentExists = section.groups.some(
    /** Tells whether this is the parent group. */
    (group) => group.id === parentId,
  );
  return referenceIssue(!parentExists, path);
}

/** Checks a group's parent reference, then whether its parent chain repeats a group. */
function validateGroupAncestry(
  group: Group,
  section: Section,
  path: string,
): readonly Diagnostic[] {
  const parentIssues = validateParentReference(group.parent, section, `${path}.parent`);
  const cycleExists = hasCycle(
    group.id,
    /** The group's parent in this section. */
    (id) => parentGroup(id, section),
  );
  const cycleIssues = diagnoseWhen(
    cycleExists,
    'group',
    path,
    'Group parent graph must be acyclic',
  );
  return [...parentIssues, ...cycleIssues];
}
