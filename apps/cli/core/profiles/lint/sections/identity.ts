/*
 * Section identity rules of the build-spec profile: section IDs are unique, and a section that
 * takes a required slot's ID uses one of that slot's modes. Pure; each rule returns its findings.
 */
import type { ProfileFinding } from '../../../../contract/records/profiles.js';
import { buildSpecProfile } from '../../build-spec/descriptor.js';
import { id, text, type Declaration, type DeclarationIndex } from '../declarations.js';
import { fieldFinding } from '../findings.js';

const reserved = new Map(buildSpecProfile.slots.map((slot) => [slot.id.slice(1), slot]));

/** Duplicate-id and reserved-mode findings, tracked across the section list. */
export function lintSectionIdentity(indexed: DeclarationIndex): ProfileFinding[] {
  const seen = new Map<string, Declaration>();
  const findings: ProfileFinding[] = [];
  for (const section of indexed.sections) {
    findings.push(...identifySection(seen, section));
  }
  return findings;
}

/** One section's identity findings, remembering its id for the sections after it. */
function identifySection(
  seen: Map<string, Declaration>,
  section: Declaration,
): ProfileFinding[] {
  const sectionId = id(section);
  if (sectionId === undefined) return [];
  const findings = [
    ...duplicateFinding(seen, section, sectionId),
    ...reservedModeFinding(section, sectionId),
  ];
  seen.set(sectionId, section);
  return findings;
}

/** A section id already seen is a duplicate. */
function duplicateFinding(
  seen: ReadonlyMap<string, Declaration>,
  section: Declaration,
  sectionId: string,
): ProfileFinding[] {
  return seen.has(sectionId)
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
