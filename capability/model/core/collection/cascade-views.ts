import type { ObjectId, GroupId, RelationshipId } from '../../contract/brands.js';
import type { Section, Appearance, Group, SequenceItem } from '../../contract/records/section.js';
import type { LayoutIntent, LayoutTarget } from '../../contract/records/layout.js';

/**
 * Removes a deleted object from one section, for `delete-object`. The cascade is computed for
 * every deletion; without `cascade`, any difference it makes fails the deletion as
 * `delete-referenced`. Unrelated content and child groups are kept:
 * - the object's appearances are removed;
 * - groups that represent the object are removed; appearances in those groups become ungrouped,
 *   and groups nested in them lose their `parent` (moving to the top level);
 * - wires for the removed relationships are removed;
 * - layout constraints (the section's and each remaining group's) with any target that is the
 *   object or a removed group are removed whole;
 * - sequence events from or to the object are removed; fragments stay;
 * - a tree `root` naming the object is cleared.
 *
 * The result may need repair by another change in the same batch (for example a tree without a
 * root). Pure copy: `section` is not changed. `plan` validates the final candidate; Authoring owns
 * commit and crash recovery.
 *
 * @param section - The section to clean.
 * @param removedId - The deleted object's ID.
 * @param removedRelationships - The relationships deleted with it.
 * @returns A new section: the original fields in their order (without `root` when cleared), with
 * new `appearances`, `groups`, `wires`, `layout` and `sequence`. Unchanged appearances are the same
 * objects as before; every remaining group is a new copy with a new layout.
 * @throws Never for a parsed section.
 */
export function cascadeSection(
  section: Section,
  removedId: ObjectId,
  removedRelationships: readonly RelationshipId[],
): Section {
  const representingGroups = section.groups.filter(
    /** Tells whether the group represents the deleted object. */
    (group) => group.represents === removedId,
  );
  const removedGroups = representingGroups.map(
    /** The group's ID. */
    (group) => group.id,
  );
  const survivingAppearances = section.appearances.filter(
    /** Keeps appearances of other objects. */
    (appearance) => appearance.object !== removedId,
  );
  const appearances = survivingAppearances.map(
    /** Ungroups the appearance if its group was removed. */
    (appearance) => detachAppearance(appearance, removedGroups),
  );
  const survivingGroups = section.groups.filter(
    /** Keeps groups that do not represent the deleted object. */
    (group) => group.represents !== removedId,
  );
  const groups = survivingGroups.map(
    /** Drops a removed parent, then prunes the group's layout. */
    (group) => {
      const detachedGroup = detachGroup(group, removedGroups);
      const layout = pruneLayout(group.layout, removedId, removedGroups);
      return { ...detachedGroup, layout };
    },
  );
  const wires = section.wires.filter(
    /** Keeps wires whose relationship was not removed. */
    (wire) => !removedRelationships.includes(wire.relationship),
  );
  const layout = pruneLayout(section.layout, removedId, removedGroups);
  const sequence = section.sequence.filter(
    /** Keeps fragments and events that do not involve the deleted object. */
    (item) => sequenceItemSurvives(item, removedId),
  );
  const rootedSection = clearDeletedRoot(section, removedId);
  return { ...rootedSection, appearances, groups, wires, layout, sequence };
}

/**
 * Returns an appearance whose group was removed as a copy without `group` (other fields in their
 * order). Any other appearance is returned as it is.
 */
function detachAppearance(
  appearance: Appearance,
  removedGroups: readonly GroupId[],
): Appearance {
  if (appearance.group === undefined) {
    return appearance;
  }
  if (!removedGroups.includes(appearance.group)) {
    return appearance;
  }
  return withoutField(appearance, 'group');
}

/**
 * Returns a group whose parent was removed as a copy without `parent` (other fields in their
 * order). Any other group is returned as it is.
 */
function detachGroup(
  group: Group,
  removedGroups: readonly GroupId[],
): Group {
  if (group.parent === undefined) {
    return group;
  }
  if (!removedGroups.includes(group.parent)) {
    return group;
  }
  return withoutField(group, 'parent');
}

/** Tells whether a layout target is the deleted object or a removed group. */
function addressesRemovedTarget(
  target: LayoutTarget,
  removedId: ObjectId,
  removedGroups: readonly GroupId[],
): boolean {
  if (target.kind === 'object') {
    return target.id === removedId;
  }
  return target.kind === 'group' && removedGroups.includes(target.id);
}

/** Returns a copy of the layout keeping only constraints whose targets all survive. */
function pruneLayout(
  layout: LayoutIntent,
  removedId: ObjectId,
  removedGroups: readonly GroupId[],
): LayoutIntent {
  const constraints = layout.constraints.filter(
    /** Keeps the constraint unless one of its targets was removed. */
    (constraint) => {
      const hasRemovedTarget = constraint.targets.some(
        /** Tells whether this target was removed. */
        (target) => addressesRemovedTarget(target, removedId, removedGroups),
      );
      return !hasRemovedTarget;
    },
  );
  return { ...layout, constraints };
}

/**
 * Returns a section rooted at the deleted object as a copy without `root`; any other section as
 * it is. Final validation decides whether a new root is needed.
 */
function clearDeletedRoot(
  section: Section,
  removedId: ObjectId,
): Section {
  if (section.root !== removedId) {
    return section;
  }
  return withoutField(section, 'root');
}

/** Tells whether a sequence item stays: fragments always; events not from or to the object. */
function sequenceItemSurvives(
  item: SequenceItem,
  removedId: ObjectId,
): boolean {
  if (item.kind !== 'event') {
    return true;
  }
  return item.source !== removedId && item.target !== removedId;
}

/**
 * Returns a copy of the record without one optional field; the other own fields keep their order.
 * Reads the field first, then copies the rest (the same reads as a rest destructuring).
 */
function withoutField<T extends object, K extends keyof T>(
  record: T,
  key: K,
): Omit<T, K> {
  const { [key]: removedValue, ...rest } = record;
  // `void` marks the removed value as deliberately unused; only the rest copy is kept.
  void removedValue;
  return rest;
}
