/*
 * The manual snapshot: the human layout decisions a collection stores (placements, orders, wire
 * sides, locks and bend points) that its DSL source does not hold. Export captures it when
 * building a bundle, and overlays it when checking that the built bundle round-trips and when
 * preparing an import.
 * Automatic geometry is never captured; Layout recomputes it.
 */
import type { Collection } from '../../contract/records/artifact.js';
import type { ManualSnapshot, ManualSection } from '../../contract/records/manual.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { success } from '../validation/outcomes.js';
import { restoreOrder, validOrder } from './order.js';

/** One section of a collection. */
type Section = Collection['sections'][number];

/**
 * Captures a collection's stored layout overrides. For every section it records the order of
 * appearances, groups and sequence items, the appearances and groups that have a stored
 * placement, every wire's sides, lock and bend points, and the section's own placement when it
 * has one. Items without a stored placement are left out, not given an automatic one.
 *
 * Placements are shared with the collection, not copied; bend-point lists are new arrays that
 * hold the same point objects. Pure: reading the collection has no side effects, so it is safe
 * to repeat.
 *
 * @param collection - The collection to capture from.
 * @returns The manual snapshot, `schemaVersion` 1, one entry per section in collection order.
 * @throws Never for plain collection data; a throwing getter or proxy propagates.
 */
export function captureManual(collection: Collection): ManualSnapshot {
  return { schemaVersion: 1, sections: collection.sections.map(captureSection) };
}

/**
 * Applies a manual snapshot to a collection parsed from DSL. Every override is checked first;
 * when any check fails nothing is applied and no partial collection is returned.
 *
 * Checks, in order:
 * 1. Section overrides have unique IDs that all exist in the collection
 *    (`invalid-import` at `manual.sections`).
 * 2. For each section override: its appearance, group and sequence orders are complete, and its
 *    appearance, group and wire overrides have unique IDs that exist in that section
 *    (`invalid-import` at `manual`). All four checks run for a section; sections stop at the
 *    first one that fails.
 *
 * Then, for each section that has an override: appearances, groups and sequence items are put
 * back in the stored order (sequence items also take their stored order numbers), each
 * overridden appearance, group and wire takes the override's fields, and the section's
 * placement is replaced when the override has one. Sections without an override are returned
 * as the same objects. Semantic structure always comes from the DSL.
 * Pure and safe to repeat; the caller re-validates the result through Model.
 *
 * @param collection - The collection parsed from the bundle's DSL.
 * @param manual - The manual snapshot to apply.
 * @returns The overlaid collection (not yet validated, hence `unknown`), or `invalid-import`.
 * @throws Never for plain parsed data; a throwing getter or proxy propagates.
 */
export function overlayManual(
  collection: Collection,
  manual: ManualSnapshot,
): Result<unknown> {
  const invalid = validateTargets(collection, manual);
  if (!invalid.ok) return invalid;
  const sections = collection.sections.map(
    /** The section with its manual override, if any, laid over it. */ (section) => {
      const override = manual.sections.find(
        /** Whether the override is for this section. */ (item) => item.id === section.id,
      );
      return overlaySection(section, override);
    },
  );
  return success({ ...collection, sections });
}

/** One section's overrides. `placement` is added last, and only when the section has one. */
function captureSection(section: Section): ManualSection {
  const record: ManualSection = {
    id: section.id,
    appearanceOrder: section.appearances.map(
      /** The appearance's object ID. */ (item) => item.object,
    ),
    groupOrder: section.groups.map(/** The group's ID. */ (item) => item.id),
    sequenceOrder: section.sequence.map(
      /** The sequence item's ID and order. */ (item) => ({ id: item.id, order: item.order }),
    ),
    appearances: section.appearances.flatMap(
      /** The object and its stored placement; nothing when it has none. */ (item) =>
        placedAppearance(item),
    ),
    groups: section.groups.flatMap(
      /** The group and its stored placement; nothing when it has none. */ (item) =>
        placedGroup(item),
    ),
    wires: section.wires.map(captureWire),
  };
  if (section.placement) return { ...record, placement: section.placement };
  return record;
}

/** The appearance's object ID and stored placement; empty when it has no stored placement. */
function placedAppearance(item: Section['appearances'][number]): ManualSection['appearances'] {
  if (!item.placement) return [];
  return [{ object: item.object, placement: item.placement }];
}

/** The group's ID and stored placement; empty when it has no stored placement. */
function placedGroup(item: Section['groups'][number]): ManualSection['groups'] {
  if (!item.placement) return [];
  return [{ id: item.id, placement: item.placement }];
}

/**
 * One wire's relationship ID, lock and sides, plus a copy of its bend points when it has any.
 * The route itself stays in the DSL.
 */
function captureWire(item: Section['wires'][number]): ManualSection['wires'][number] {
  const record = {
    relationship: item.relationship,
    locked: item.locked,
    sourceSide: item.sourceSide,
    targetSide: item.targetSide,
  };
  if (item.manual) return { ...record, manual: [...item.manual] };
  return record;
}

/**
 * Checks every override target before anything is applied. `find` and `map` would silently
 * ignore unknown or duplicate targets, so they are rejected here.
 */
function validateTargets(
  collection: Collection,
  manual: ManualSnapshot,
): Result<void> {
  const overriddenIds = manual.sections.map(
    /** The overridden section's ID. */ (section) => section.id,
  );
  const sectionIds = collection.sections.map(/** The section's ID. */ (section) => section.id);
  if (!validIds(overriddenIds, sectionIds))
    return failure('invalid-import', 'manual.sections', 'Unknown or duplicate section override');
  const valid = manual.sections.every(
    /** Whether the section override names only this collection's targets, once each. */
    (section) => validSection(collection, section),
  );
  if (!valid) return failure('invalid-import', 'manual', 'Unknown or duplicate manual target');
  return success(undefined);
}

/** Whether `actual` has no repeated IDs and every ID is in `allowed`. An empty list is valid. */
function validIds(
  actual: readonly string[],
  allowed: readonly string[],
): boolean {
  return (
    new Set(actual).size === actual.length &&
    actual.every(/** Whether the ID is allowed. */ (id) => allowed.includes(id))
  );
}

/**
 * Whether one section override fits its section: complete orders, and appearance, group and
 * wire overrides that each name a real item once. All four checks run. Coordinate shapes are
 * not checked here: on import the bundle schema checked them; when building a bundle they come
 * from the collection.
 */
function validSection(
  collection: Collection,
  manual: ManualSection,
): boolean {
  const section = collection.sections.find(
    /** Whether this is the overridden section. */ (item) => item.id === manual.id,
  );
  if (!section) return false;
  const checks = [
    validOrder(section, manual),
    validIds(
      manual.appearances.map(/** The override's object ID. */ (item) => item.object),
      section.appearances.map(/** The appearance's object ID. */ (item) => item.object),
    ),
    validIds(
      manual.groups.map(/** The override's group ID. */ (item) => item.id),
      section.groups.map(/** The group's ID. */ (item) => item.id),
    ),
    validIds(
      manual.wires.map(/** The override's relationship ID. */ (item) => item.relationship),
      section.wires.map(/** The wire's relationship ID. */ (item) => item.relationship),
    ),
  ];
  return checks.every(Boolean);
}

/**
 * Applies one section's override: restores the stored order, then lets each override's fields
 * replace the matching appearance, group or wire fields (each item is copied first, then its
 * override, if any, is looked up and applied). Wires keep the DSL's order. Returns the section
 * itself when there is no override.
 */
function overlaySection(
  section: Section,
  manual: ManualSection | undefined,
): unknown {
  if (!manual) return section;
  const ordered = restoreOrder(section, manual);
  const next = {
    ...ordered,
    appearances: ordered.appearances.map(
      /** The appearance with its override, if any, laid over a copy. */ (item) => {
        const copy = { ...item };
        const override = manual.appearances.find(
          /** Whether the override is for this appearance's object. */ (entry) =>
            entry.object === item.object,
        );
        return { ...copy, ...override };
      },
    ),
    groups: ordered.groups.map(
      /** The group with its override, if any, laid over a copy. */ (item) => {
        const copy = { ...item };
        const override = manual.groups.find(
          /** Whether the override is for this group. */ (entry) => entry.id === item.id,
        );
        return { ...copy, ...override };
      },
    ),
    wires: section.wires.map(
      /** The wire with its override, if any, laid over a copy. */ (item) => {
        const copy = { ...item };
        const override = manual.wires.find(
          /** Whether the override is for this wire's relationship. */ (entry) =>
            entry.relationship === item.relationship,
        );
        return { ...copy, ...override };
      },
    ),
  };
  if (manual.placement) return { ...next, placement: manual.placement };
  return next;
}
