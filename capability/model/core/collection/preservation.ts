import type { Collection } from '../../contract/records/collection.js';
import type { Section, Appearance, Group, WireAppearance } from '../../contract/records/section.js';
import type { Placement } from '../../contract/records/layout.js';

/**
 * Carries hand-made geometry from a section's previous version into its replacement, for a
 * section `replace` and for each matching section of a `replace-document`. Geometry the new
 * version states explicitly always wins; only omitted geometry is inherited:
 * - the section's own `placement`;
 * - each appearance's `placement`, from the previous appearance of the same object; only when
 *   there was no such appearance, from a previous group that represented the object;
 * - each group's `placement`, from the previous group with the same ID; only when there was no
 *   such group, from the previous appearance of the object it represents;
 * - each wire's `manual` route (with its `locked` flag), from the previous wire of the same
 *   relationship.
 * A matching record without geometry is never replaced by the fallback. An inherited field the
 * new record lacks is added last (`placement`, or `manual` then `locked` on a wire); a `locked`
 * field already there keeps its position. `reset-layout` and `reset-route` do not come through
 * here, so a later replacement keeps the reset state.
 *
 * Pure copy: neither section is changed. `plan` validates the result; Authoring owns commit and
 * crash recovery.
 *
 * @param next - The replacement section.
 * @param previous - The section it replaces.
 * @returns A new section with `next`'s fields in their order and new `appearances`, `groups`
 * and `wires` lists; records that inherit nothing are the same objects as in `next`.
 * @throws Never for parsed sections.
 */
export function preserveSection(
  next: Section,
  previous: Section,
): Section {
  const section = inheritPlacement(next, previous.placement);
  const appearances = next.appearances.map(
    /** Inherits the appearance's previous placement, if it has none. */
    (appearance) => {
      const previousPlacement = previousAppearancePlacement(appearance, previous);
      return inheritPlacement(appearance, previousPlacement);
    },
  );
  const groups = next.groups.map(
    /** Inherits the group's previous placement, if it has none. */
    (group) => {
      const previousPlacement = previousGroupPlacement(group, previous);
      return inheritPlacement(group, previousPlacement);
    },
  );
  const wires = next.wires.map(
    /** Inherits the wire's previous manual route, if it has none. */
    (wire) => preserveWireRoute(wire, previous),
  );
  return { ...section, appearances, groups, wires };
}

/**
 * Applies {@link preserveSection} to every section of a replacement collection that has a
 * section with the same ID in the current collection. New sections are kept as they are.
 *
 * Pure copy: neither collection is changed. `plan` validates the result; Authoring owns commit
 * and crash recovery.
 *
 * @param next - The replacement collection.
 * @param previous - The current collection.
 * @returns A new collection with `next`'s fields in their order and a new `sections` list
 * (inherited fields are added as {@link preserveSection} describes).
 * @throws Never for parsed collections.
 */
export function preserveOverrides(
  next: Collection,
  previous: Collection,
): Collection {
  const sections = next.sections.map(
    /** Preserves one section's geometry from its previous version, if any. */
    (section) => preserveMatchingSection(section, previous),
  );
  return { ...next, sections };
}

/**
 * Clears a wire's manual route: removes `manual` and sets `locked` to `false`. Its routing style
 * and attachment preferences stay. Used by `reset-route` and `reset-layout`. Pure copy; Authoring
 * owns commit and crash recovery.
 *
 * @param wire - The wire to reset.
 * @returns A new wire with the other fields in their order; `locked` keeps its position, or is
 * added last when it was absent.
 * @throws Never.
 */
export function clearRoute(wire: WireAppearance): WireAppearance {
  const { manual: removedPoints, ...automaticRoute } = wire;
  // `void` marks the removed field as deliberately unused; only the rest copy is kept.
  void removedPoints;
  return { ...automaticRoute, locked: false };
}

/**
 * Clears all of a section's geometry, for `reset-layout`: the section's, every appearance's and
 * every group's `placement`, and every wire's manual route (see {@link clearRoute}). Layout
 * constraints and other content stay. Resetting twice gives the same result. Pure copy; Authoring
 * owns commit and crash recovery.
 *
 * @param section - The section to reset.
 * @returns A new section with the other fields in their order and new `appearances`, `groups`
 * and `wires` lists (every record copied).
 * @throws Never.
 */
export function clearSection(section: Section): Section {
  const unplacedSection = clearPlacement(section);
  const appearances = section.appearances.map(clearPlacement);
  const groups = section.groups.map(clearPlacement);
  const wires = section.wires.map(clearRoute);
  return { ...unplacedSection, appearances, groups, wires };
}

/** Any record that may carry a `placement`. */
type PlacedRecord = { readonly placement?: Placement | undefined };

/**
 * Returns the record with the previous placement when it has none of its own and there is one
 * to inherit; otherwise the record as it is.
 */
function inheritPlacement<T extends PlacedRecord>(
  next: T,
  previousPlacement: Placement | undefined,
): T {
  if (next.placement !== undefined) {
    return next;
  }
  if (previousPlacement === undefined) {
    return next;
  }
  return { ...next, placement: previousPlacement };
}

/**
 * Finds an appearance's previous placement: from the previous appearance of the same object; only
 * when there was none, from a previous group that represented the object.
 */
function previousAppearancePlacement(
  appearance: Appearance,
  previous: Section,
): Placement | undefined {
  const previousAppearance = previous.appearances.find(
    /** Tells whether this previous appearance shows the same object. */
    (item) => item.object === appearance.object,
  );
  if (previousAppearance !== undefined) {
    return previousAppearance.placement;
  }
  const representedGroup = previous.groups.find(
    /** Tells whether this previous group represented the object. */
    (group) => group.represents === appearance.object,
  );
  return representedGroup?.placement;
}

/**
 * Finds a group's previous placement: from the previous group with the same ID; only when there
 * was none, from the previous appearance of the object the group represents.
 */
function previousGroupPlacement(
  group: Group,
  previous: Section,
): Placement | undefined {
  const previousGroup = previous.groups.find(
    /** Tells whether this previous group has the same ID. */
    (item) => item.id === group.id,
  );
  if (previousGroup !== undefined) {
    return previousGroup.placement;
  }
  const previousAppearance = previous.appearances.find(
    /** Tells whether this previous appearance shows the represented object. */
    (item) => item.object === group.represents,
  );
  return previousAppearance?.placement;
}

/**
 * Returns a wire without a manual route as a copy carrying the previous wire's `manual` and
 * `locked`, when the previous wire of the same relationship had a manual route; otherwise the
 * wire as it is.
 */
function preserveWireRoute(
  wire: WireAppearance,
  previous: Section,
): WireAppearance {
  if (wire.manual !== undefined) {
    return wire;
  }
  const previousWire = previous.wires.find(
    /** Tells whether this previous wire draws the same relationship. */
    (item) => item.relationship === wire.relationship,
  );
  if (previousWire?.manual === undefined) {
    return wire;
  }
  return { ...wire, manual: previousWire.manual, locked: previousWire.locked };
}

/** Preserves a section's geometry from the previous section with its ID; a new section as it is. */
function preserveMatchingSection(
  section: Section,
  previous: Collection,
): Section {
  const previousSection = previous.sections.find(
    /** Tells whether this is the previous version of the section. */
    (item) => item.id === section.id,
  );
  if (previousSection === undefined) {
    return section;
  }
  return preserveSection(section, previousSection);
}

/**
 * Returns a copy without `placement` (the field is removed, not set to `undefined`), so layout
 * treats the record as automatically placed.
 */
function clearPlacement<T extends PlacedRecord>(value: T): Omit<T, 'placement'> {
  const { placement: removedPlacement, ...unplaced } = value;
  // `void` marks the removed field as deliberately unused; only the rest copy is kept.
  void removedPlacement;
  return unplaced;
}
