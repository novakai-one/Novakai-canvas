/*
 * Section identity rules of the build-spec profile: section IDs are unique, and a section that
 * takes a required slot's ID uses one of that slot's modes. Pure; each rule returns its findings.
 */
import type { ProfileFinding, ProfileSlot } from '../../../../contract/records/profiles.js';
import { buildSpecProfile } from '../../build-spec/descriptor.js';
import { id, text, type Declaration, type DeclarationIndex } from '../declarations.js';
import { fieldFinding } from '../findings.js';

const reserved: ReadonlyMap<string, ProfileSlot> = new Map(
  buildSpecProfile.slots.map((slot) => [slot.id.slice(1), slot]),
);

/** Duplicate-id and reserved-mode findings, section by section in document order. */
export function lintSectionIdentity(indexed: DeclarationIndex): ProfileFinding[] {
  const sectionIds = indexed.sections.map(id);
  return indexed.sections.flatMap((section, index) =>
    identifySection(section, sectionIds.slice(0, index)),
  );
}

/** One section's identity findings; `earlier` holds the ids of the sections before it. */
function identifySection(
  section: Declaration,
  earlier: readonly (string | undefined)[],
): ProfileFinding[] {
  const sectionId = id(section);
  if (sectionId === undefined) return [];
  return [
    ...duplicateFinding(section, sectionId, earlier),
    ...reservedModeFinding(section, sectionId),
  ];
}

/** A section id an earlier section already uses is a duplicate. */
function duplicateFinding(
  section: Declaration,
  sectionId: string,
  earlier: readonly (string | undefined)[],
): ProfileFinding[] {
  return earlier.includes(sectionId)
    ? [
        fieldFinding(section, 'id', {
          code: 'duplicate-section',
          path: `section @${sectionId}`,
          message: 'Section ID is duplicated.',
        }),
      ]
    : [];
}

/**
 * A required slot's section must use one of the slot's modes. Known overlap: for a present slot
 * with a wrong mode, `requiredSectionFinding` (required.ts) reports the same span again.
 */
function reservedModeFinding(
  section: Declaration,
  sectionId: string,
): ProfileFinding[] {
  const slot = reserved.get(sectionId);
  const mode = text(section, 'mode');
  return slot !== undefined && mode !== undefined && !slot.modes.some((allowed) => allowed === mode)
    ? [
        fieldFinding(section, 'mode', {
          code: 'reserved-slot-mode',
          path: `section @${sectionId}`,
          message: `Required slot must use mode ${slot.modes.join(' or ')}.`,
        }),
      ]
    : [];
}
