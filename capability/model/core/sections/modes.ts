import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type { Relationship, RelationshipKind } from '../../contract/records/relationship.js';
import type { Section, Mode } from '../../contract/records/section.js';
import { compatibleLayouts, compatibleWires } from '../../contract/records/policies.js';
import { duplicates } from '../invariants/duplicates.js';
import { diagnoseWhen } from '../invariants/issues.js';
import { visibleObjects } from './groups.js';
import { sectionPath } from './paths.js';

/**
 * Returns the relationships a section draws as wires, in the collection's relationship order.
 * Wires naming a missing relationship are skipped (the view rules report them). Pure: reads
 * only; Authoring owns correction, commit and crash recovery.
 *
 * @param section - A parsed section.
 * @param collection - The collection the section belongs to.
 * @returns A new list of the collection's own relationship records.
 * @throws Never for parsed data.
 */
export function visibleRelationships(
  section: Section,
  collection: Collection,
): readonly Relationship[] {
  return collection.relationships.filter(
    /** Tells whether the section has a wire for this relationship. */
    (relationship) =>
      section.wires.some(
        /** Tells whether this wire draws the relationship. */
        (wire) => wire.relationship === relationship.id,
      ),
  );
}

/**
 * Checks that a section's contents fit its mode. Every failure except (5) is a `mode` diagnostic,
 * collected in this order:
 * 1. the section's layout, then each group's layout, must use an algorithm the mode allows
 *    (`compatibleLayouts`), at `sections.<id>.layout` (also for a group's layout), "Mode and
 *    layout must be compatible";
 * 2. each drawn relationship (in collection order) must be a kind the mode allows
 *    (`compatibleWires`; no entry allows every kind), at `sections.<id>.wires.<relationship>`,
 *    "Wire kind is not legal in this mode";
 * 3. sequence items only in `sequence` mode, at `sections.<id>.sequence`, "Sequence items are
 *    sequence-only";
 * 4. outside `tree` mode: no `root` (at `sections.<id>.root`, "Root is tree-only"), and no
 *    appearance `participation` (at `sections.<id>.appearances.<object>`, "Participation is
 *    tree-only");
 * 5. in `flow` mode, the drawn `flow` relationships leaving each visible decision must have distinct
 *    labels: `duplicate` (not `mode`) at `sections.<id>.decision.<decision>.<label>`.
 *
 * Pure: Authoring owns correction, commit and crash recovery.
 *
 * @param section - A parsed section.
 * @param collection - The collection the section belongs to.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for parsed data.
 */
export function validateModes(
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  const path = sectionPath(section);
  const layoutIssues = validateLayoutCompatibility(section);
  const wireIssues = visibleRelationships(section, collection).flatMap(
    /** Checks that the mode allows this relationship's kind. */
    (wire) =>
      diagnoseWhen(
        !isAllowedWire(wire.kind, section.mode),
        'mode',
        `${path}.wires.${wire.id}`,
        'Wire kind is not legal in this mode',
      ),
  );
  const sequenceInWrongMode = section.mode !== 'sequence' && section.sequence.length > 0;
  const sequenceIssues = diagnoseWhen(
    sequenceInWrongMode,
    'mode',
    `${path}.sequence`,
    'Sequence items are sequence-only',
  );
  const treeFieldIssues = validateTreeOnlyFields(section);
  const decisionIssues = validateDecisionLabels(section, collection);
  return [...layoutIssues, ...wireIssues, ...sequenceIssues, ...treeFieldIssues, ...decisionIssues];
}

/**
 * In `flow` mode, reports repeated labels among the `flow` relationships leaving each visible
 * decision object. Other modes give nothing.
 */
function validateDecisionLabels(
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  if (section.mode !== 'flow') {
    return [];
  }
  const visible = visibleObjects(section);
  const decisions = collection.objects.filter(
    /** Tells whether the object is a decision shown in this section. */
    (object) => object.kind === 'decision' && visible.includes(object.id),
  );
  const relationships = visibleRelationships(section, collection);
  return decisions.flatMap(
    /** Reports repeated labels on one decision's outgoing flows. */
    (decision) => {
      const outgoing = relationships.filter(
        /** Tells whether this is a flow leaving the decision. */
        (wire) => wire.kind === 'flow' && wire.source.object === decision.id,
      );
      return duplicates(
        outgoing,
        /** A flow's key is its label. */
        (wire) => wire.label,
        `${sectionPath(section)}.decision.${decision.id}`,
      );
    },
  );
}

/** Outside `tree` mode, reports a `root` and every appearance `participation`. */
function validateTreeOnlyFields(section: Section): readonly Diagnostic[] {
  if (section.mode === 'tree') {
    return [];
  }
  const rootIssues = diagnoseWhen(
    section.root !== undefined,
    'mode',
    `${sectionPath(section)}.root`,
    'Root is tree-only',
  );
  const participationIssues = section.appearances.flatMap(
    /** Reports the appearance's participation, if set. */
    (appearance) =>
      diagnoseWhen(
        appearance.participation !== undefined,
        'mode',
        `${sectionPath(section)}.appearances.${appearance.object}`,
        'Participation is tree-only',
      ),
  );
  return [...rootIssues, ...participationIssues];
}

/** Tells whether a mode allows a relationship kind; a mode with no policy entry allows all. */
function isAllowedWire(
  kind: RelationshipKind,
  mode: Mode,
): boolean {
  const allowedKinds = compatibleWires[mode];
  if (allowedKinds === undefined) {
    return true;
  }
  return allowedKinds.includes(kind);
}

/** Reports the section's layout and each group's layout whose algorithm the mode does not allow. */
function validateLayoutCompatibility(section: Section): readonly Diagnostic[] {
  const sectionLayout = section.layout;
  const groupLayouts = section.groups.map(
    /** The group's layout. */
    (group) => group.layout,
  );
  const layouts = [sectionLayout, ...groupLayouts];
  return layouts.flatMap(
    /** Checks one layout's algorithm against the mode. */
    (layout) =>
      diagnoseWhen(
        !compatibleLayouts[section.mode].includes(layout.algorithm),
        'mode',
        `${sectionPath(section)}.layout`,
        'Mode and layout must be compatible',
      ),
  );
}
