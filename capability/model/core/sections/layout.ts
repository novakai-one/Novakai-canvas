import type { GroupId } from '../../contract/brands.js';
import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type {
  LayoutIntent,
  LayoutTarget,
  LayoutConstraint,
} from '../../contract/records/layout.js';
import type { Section } from '../../contract/records/section.js';
import { diagnoseWhen, referenceIssue } from '../invariants/issues.js';
import { duplicates } from '../invariants/duplicates.js';
import { nestedIn, visibleObjects } from './groups.js';
import { sectionPath } from './paths.js';

/**
 * Checks every layout request: the collection's `arrangement`, then each section's layout
 * followed by its groups' layouts. Only the request is checked; no geometry is computed. Every
 * failure is collected.
 *
 * Each layout (at `<layout path>`) reports, in this order:
 * 1. `columns` without the `grid` algorithm: `layout` at `<layout path>.columns`, "Columns require
 *    grid layout";
 * 2. per constraint, at `<layout path>.constraints.<index>`: repeated targets (`duplicate` at
 *    `...<index>.<kind>:<id>`), then `before`/`below` without exactly two targets (`layout`,
 *    "before/below need exactly two targets");
 * 3. each target that does not resolve (`reference` at `<layout path>.<target id>`): in the
 *    arrangement, a target must be an existing section; in a section or group layout, a visible
 *    object or a group of that section;
 * 4. for a group's layout, each target that is not inside that group (by appearance group,
 *    represented group's parent, or group parent chain): `layout` at `<layout path>.<target
 *    id>`, "Group constraints must address descendants".
 *
 * Paths: `arrangement`, `sections.<id>.layout`, `sections.<id>.groups.<group>.layout`. Pure:
 * Authoring owns correction, commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateLayouts(collection: Collection): readonly Diagnostic[] {
  const arrangementIssues = validateArrangement(collection);
  const sectionIssues = collection.sections.flatMap(validateSectionLayouts);
  return [...arrangementIssues, ...sectionIssues];
}

/** Checks one constraint: repeated targets, then that `before`/`below` have exactly two. */
function validateConstraint(
  constraint: LayoutConstraint,
  path: string,
): readonly Diagnostic[] {
  const duplicateTargets = duplicates(
    constraint.targets,
    /** A target's key is its kind and ID. */
    (target) => `${target.kind}:${target.id}`,
    path,
  );
  const requiresPair = constraint.kind === 'before' || constraint.kind === 'below';
  const wrongArity = requiresPair && constraint.targets.length !== 2;
  const arityIssues = diagnoseWhen(
    wrongArity,
    'layout',
    path,
    'before/below need exactly two targets',
  );
  return [...duplicateTargets, ...arityIssues];
}

/** Checks the rules shared by every layout level: `columns` needs `grid`, then each constraint. */
function validateConstraintShapes(
  layout: LayoutIntent,
  path: string,
): readonly Diagnostic[] {
  const columnIssues = diagnoseWhen(
    layout.columns !== undefined && layout.algorithm !== 'grid',
    'layout',
    `${path}.columns`,
    'Columns require grid layout',
  );
  const constraints = layout.constraints.flatMap(
    /** Checks one constraint at its index path. */
    (constraint, index): readonly Diagnostic[] =>
      validateConstraint(constraint, `${path}.constraints.${index}`),
  );
  return [...columnIssues, ...constraints];
}

/**
 * Tells whether a section-level target resolves: an object the section shows, or one of its
 * groups. A section target never resolves here.
 */
function isVisibleTarget(
  target: LayoutTarget,
  section: Section,
): boolean {
  if (target.kind === 'object') {
    return visibleObjects(section).includes(target.id);
  }
  if (target.kind !== 'group') {
    return false;
  }
  return section.groups.some(
    /** Tells whether this is the target group. */
    (group) => group.id === target.id,
  );
}

/**
 * Returns the group a target sits in. A group target: its parent. Any other target (an object,
 * or an invalid section target): the group of the first appearance whose object has the
 * target's ID; when there is no such appearance or its `group` is undefined, the parent of the
 * first group that represents that ID.
 */
function targetParent(
  target: LayoutTarget,
  section: Section,
): GroupId | undefined {
  if (target.kind === 'group') {
    const group = section.groups.find(
      /** Tells whether this is the target group. */
      (candidate) => candidate.id === target.id,
    );
    return group?.parent;
  }
  const appearance = section.appearances.find(
    /** Tells whether this appearance shows the target object. */
    (candidate) => candidate.object === target.id,
  );
  if (appearance?.group !== undefined) {
    return appearance.group;
  }
  const representation = section.groups.find(
    /** Tells whether this group represents the target object. */
    (group) => group.represents === target.id,
  );
  return representation?.parent;
}

/**
 * For a group's layout, reports each target that is not inside the group. A section's own
 * layout (no owner) gives nothing.
 */
function validateGroupScope(
  targets: readonly LayoutTarget[],
  section: Section,
  path: string,
  ownerId: GroupId | undefined,
): readonly Diagnostic[] {
  if (ownerId === undefined) {
    return [];
  }
  return targets.flatMap(
    /** Reports the target if it is not inside the owning group. */
    (target) => {
      const parentId = targetParent(target, section);
      const isDescendant = nestedIn(parentId, ownerId, section);
      return diagnoseWhen(
        !isDescendant,
        'layout',
        `${path}.${target.id}`,
        'Group constraints must address descendants',
      );
    },
  );
}

/**
 * Checks a section or group layout: shared rules, then every target resolves in the section,
 * then (for a group) every target is inside that group.
 */
function validateLocalLayout(
  layout: LayoutIntent,
  section: Section,
  path: string,
  ownerId?: GroupId,
): readonly Diagnostic[] {
  const shapeIssues = validateConstraintShapes(layout, path);
  const targets = layout.constraints.flatMap(
    /** The constraint's targets. */
    (constraint) => constraint.targets,
  );
  const targetIssues = targets.flatMap(
    /** Reports the target if it does not resolve in the section. */
    (target) => referenceIssue(!isVisibleTarget(target, section), `${path}.${target.id}`),
  );
  const scopeIssues = validateGroupScope(targets, section, path, ownerId);
  return [...shapeIssues, ...targetIssues, ...scopeIssues];
}

/** Checks the collection's arrangement: shared rules, then every target is an existing section. */
function validateArrangement(collection: Collection): readonly Diagnostic[] {
  const shapeIssues = validateConstraintShapes(collection.arrangement, 'arrangement');
  const targets = collection.arrangement.constraints.flatMap(
    /** The constraint's targets. */
    (constraint) => constraint.targets,
  );
  const targetIssues = targets.flatMap(
    /** Reports the target unless it is an existing section. */
    (target) => {
      const sectionExists =
        target.kind === 'section' &&
        collection.sections.some(
          /** Tells whether this is the target section. */
          (section) => section.id === target.id,
        );
      return referenceIssue(!sectionExists, `arrangement.${target.id}`);
    },
  );
  return [...shapeIssues, ...targetIssues];
}

/** Checks a section's layout, then each group's layout with that group as the owner. */
function validateSectionLayouts(section: Section): readonly Diagnostic[] {
  const path = sectionPath(section);
  const sectionIssues = validateLocalLayout(section.layout, section, `${path}.layout`);
  const groupIssues = section.groups.flatMap(
    /** Checks one group's layout. */
    (group) =>
      validateLocalLayout(group.layout, section, `${path}.groups.${group.id}.layout`, group.id),
  );
  return [...sectionIssues, ...groupIssues];
}
