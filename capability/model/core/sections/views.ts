import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type { Section, WireAppearance } from '../../contract/records/section.js';
import { diagnoseWhen, referenceIssue } from '../invariants/issues.js';
import { duplicates } from '../invariants/duplicates.js';
import { validateGroups, visibleObjects } from './groups.js';
import { validateModes } from './modes.js';
import { validateTree } from './tree.js';
import { validateSequence } from './sequence.js';
import { sectionPath } from './paths.js';

/**
 * Checks every section (diagram view) against the collection's shared records, in section order.
 * No layout or rendering is done. Every failure is collected. For each section, in this order:
 * 1. its groups (`validateGroups`);
 * 2. its view references, at `sections.<id>`:
 *    - each shown object (`visibleObjects`) must exist: `reference` at `...appearances.<object>`;
 *    - each appearance `role` override must be in `theme.roles`: `reference` at
 *      `...appearances.<object>.role` (an omitted role uses the object's, checked elsewhere);
 *    - each relationship may have one wire: `duplicate` at `...wires.<relationship>`;
 *    - each wire's relationship must exist (`reference` at `...wires.<relationship>`); if it
 *      does, both its source and target objects must be shown (`reference` at `.source` /
 *      `.target`), and a `locked` wire needs `manual` points (`layout`, "Locked route requires
 *      manual points");
 * 3. its mode rules (`validateModes`), tree rules (`validateTree`), then sequence rules
 *    (`validateSequence`).
 *
 * Pure: Authoring owns correction, admission, commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateSections(collection: Collection): readonly Diagnostic[] {
  return collection.sections.flatMap(
    /** Checks one section. */
    (section) => validateSection(section, collection),
  );
}

/** A section rule: it reads one section and the collection, and returns its diagnostics. */
type SectionRule = (section: Section, collection: Collection) => readonly Diagnostic[];

/**
 * Checks one wire: its relationship exists; then both ends are shown, and a locked route has
 * manual points. A missing relationship reports only that.
 */
function validateWireAppearance(
  wire: WireAppearance,
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  const relationship = collection.relationships.find(
    /** Tells whether this is the wire's relationship. */
    (candidate) => candidate.id === wire.relationship,
  );
  const path = `${sectionPath(section)}.wires.${wire.relationship}`;
  if (relationship === undefined) {
    return referenceIssue(true, path);
  }
  const visible = visibleObjects(section);
  const sourceIssues = referenceIssue(
    !visible.includes(relationship.source.object),
    `${path}.source`,
  );
  const targetIssues = referenceIssue(
    !visible.includes(relationship.target.object),
    `${path}.target`,
  );
  const lockWithoutPoints = wire.locked && wire.manual === undefined;
  const routeIssues = diagnoseWhen(
    lockWithoutPoints,
    'layout',
    path,
    'Locked route requires manual points',
  );
  return [...sourceIssues, ...targetIssues, ...routeIssues];
}

/** Checks an appearance's role override against the theme; no override gives nothing. */
function validateRoleOverride(
  role: string | undefined,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (role === undefined) {
    return [];
  }
  return referenceIssue(!collection.theme.roles.includes(role), path);
}

/**
 * Checks a section's references to shared records: shown objects exist, role overrides are in
 * the theme, one wire per relationship, then each wire.
 */
function validateViewReferences(
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  const path = sectionPath(section);
  const objectIssues = visibleObjects(section).flatMap(
    /** Reports a shown object that does not exist. */
    (id) => {
      const objectExists = collection.objects.some(
        /** Tells whether this is the shown object. */
        (object) => object.id === id,
      );
      return referenceIssue(!objectExists, `${path}.appearances.${id}`);
    },
  );
  const roleIssues = section.appearances.flatMap(
    /** Checks one appearance's role override. */
    (appearance) =>
      validateRoleOverride(
        appearance.role,
        collection,
        `${path}.appearances.${appearance.object}.role`,
      ),
  );
  const duplicateWires = duplicates(
    section.wires,
    /** A wire's key is its relationship. */
    (wire) => wire.relationship,
    `${path}.wires`,
  );
  const wireIssues = section.wires.flatMap(
    /** Checks one wire. */
    (wire) => validateWireAppearance(wire, section, collection),
  );
  return [...objectIssues, ...roleIssues, ...duplicateWires, ...wireIssues];
}

/** The rules run on every section, in this order. Frozen: nothing may add or reorder rules. */
const sectionRules: readonly SectionRule[] = Object.freeze([
  validateGroups,
  validateViewReferences,
  validateModes,
  validateTree,
  validateSequence,
]);

/** Checks one section with every section rule, groups first. */
function validateSection(
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  return sectionRules.flatMap(
    /** Runs one rule on the section. */
    (rule) => rule(section, collection),
  );
}
