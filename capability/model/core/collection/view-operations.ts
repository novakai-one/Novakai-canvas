import type { ObjectId, RelationshipId } from '../../contract/brands.js';
import type { Collection } from '../../contract/records/collection.js';
import type { Change } from '../../contract/records/change.js';
import type { Section, WireAppearance } from '../../contract/records/section.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../invariants/issues.js';
import { clearRoute, clearSection } from './preservation.js';
import { sectionPath } from '../sections/paths.js';

/**
 * Edits one section's view for a `hide`, `reset-layout` or `reset-route` change. The section
 * must exist (else `not-found` at `sections.<section>`, "Section must exist"). Then:
 * - `hide`: the object needs an ordinary appearance in the section (a group representing it is
 *   not enough; else `not-found` at `sections.<id>.appearances.<object>`, "Hide requires
 *   ordinary appearance"). Removes every ordinary appearance of the object and the section's
 *   wires for relationships
 *   from or to the object; the object and relationships themselves stay;
 * - `reset-route`: the relationship needs a wire in the section (else `not-found` at
 *   `sections.<id>.wires.<relationship>`, "Route must be visible"), even one without a manual
 *   route. Clears that wire's manual route (see `clearRoute`);
 * - `reset-layout`: clears all of the section's geometry (see `clearSection`).
 * Resets do not go through geometry preservation, so a later replacement of the section keeps
 * the reset state.
 *
 * Pure: a failed edit leaves the whole collection unchanged; replaying against the same
 * snapshot gives the same result. `plan` validates the final candidate; Authoring owns commit
 * and crash recovery.
 *
 * @param collection - The collection so far.
 * @param change - A parsed `hide`, `reset-layout` or `reset-route` change.
 * @returns A new collection with a new `sections` list (the edited section replaced in its
 * position), or `validation-failed`. Not frozen.
 * @throws Never for a parsed change and collection.
 */
export function editView(
  collection: Collection,
  change: ViewChange,
): Result<Collection> {
  const section = collection.sections.find(
    /** Tells whether this is the section to edit. */
    (candidate) => candidate.id === change.section,
  );
  if (section === undefined) {
    return failure('not-found', `sections.${change.section}`, 'Section must exist');
  }
  return editExistingSection(section, collection, change);
}

/** A parsed change that edits a section's view. */
type ViewChange = Extract<Change, { op: 'hide' | 'reset-layout' | 'reset-route' }>;

/**
 * Hides an object in the section: removes its ordinary appearance and the wires of every
 * relationship from or to it.
 */
function hideAppearance(
  section: Section,
  collection: Collection,
  objectId: ObjectId,
): Result<Section> {
  const hasOrdinaryAppearance = section.appearances.some(
    /** Tells whether this appearance shows the object. */
    (appearance) => appearance.object === objectId,
  );
  if (!hasOrdinaryAppearance) {
    return failure(
      'not-found',
      `${sectionPath(section)}.appearances.${objectId}`,
      'Hide requires ordinary appearance',
    );
  }
  const incidentRelationships = collection.relationships.filter(
    /** Tells whether the relationship starts or ends at the object. */
    (relationship) =>
      relationship.source.object === objectId || relationship.target.object === objectId,
  );
  const incidentIds = incidentRelationships.map(
    /** The relationship's ID. */
    (relationship) => relationship.id,
  );
  const appearances = section.appearances.filter(
    /** Keeps appearances of other objects. */
    (appearance) => appearance.object !== objectId,
  );
  const wires = section.wires.filter(
    /** Keeps wires of relationships not incident to the object. */
    (wire) => !incidentIds.includes(wire.relationship),
  );
  return success({ ...section, appearances, wires });
}

/** Clears the manual route of the wire for the relationship; any other wire as it is. */
function resetMatchingWire(
  wire: WireAppearance,
  relationshipId: RelationshipId,
): WireAppearance {
  if (wire.relationship !== relationshipId) {
    return wire;
  }
  return clearRoute(wire);
}

/** Clears one wire's manual route; the wire must be in the section. */
function resetVisibleRoute(
  section: Section,
  relationshipId: RelationshipId,
): Result<Section> {
  const routeExists = section.wires.some(
    /** Tells whether this wire draws the relationship. */
    (wire) => wire.relationship === relationshipId,
  );
  if (!routeExists) {
    return failure(
      'not-found',
      `${sectionPath(section)}.wires.${relationshipId}`,
      'Route must be visible',
    );
  }
  const wires = section.wires.map(
    /** Resets the wire if it draws the relationship. */
    (wire) => resetMatchingWire(wire, relationshipId),
  );
  return success({ ...section, wires });
}

/** Applies the change to the section: `hide`, `reset-route`, or otherwise `reset-layout`. */
function applySectionEdit(
  section: Section,
  collection: Collection,
  change: ViewChange,
): Result<Section> {
  if (change.op === 'hide') {
    return hideAppearance(section, collection, change.object);
  }
  if (change.op === 'reset-route') {
    return resetVisibleRoute(section, change.relationship);
  }
  return success(clearSection(section));
}

/** Returns the edited section in place of the section with its ID; any other section as it is. */
function replaceMatchingSection(
  section: Section,
  edited: Section,
): Section {
  if (section.id !== edited.id) {
    return section;
  }
  return edited;
}

/** Edits the section, then puts it back in its position; a failed edit changes nothing. */
function editExistingSection(
  section: Section,
  collection: Collection,
  change: ViewChange,
): Result<Collection> {
  const edited = applySectionEdit(section, collection, change);
  if (!edited.ok) {
    return edited;
  }
  const sections = collection.sections.map(
    /** Swaps in the edited section. */
    (item) => replaceMatchingSection(item, edited.value),
  );
  return success({ ...collection, sections });
}
