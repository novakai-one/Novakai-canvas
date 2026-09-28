/*
 * Section identity rule of the build-spec profile: section IDs are unique. Pure; the rule returns
 * its findings. A required slot's mode is checked once, in required.ts (`section-mode`).
 */
import type { ProfileFinding } from '../../../../contract/records/profiles.js';
import type { SectionId } from '../../../../contract/brands.js';
import { sectionIdOf, type Declaration, type DeclarationIndex } from '../declarations.js';
import { fieldFinding } from '../findings.js';

/** Duplicate-id findings, section by section in document order. */
export function lintSectionIdentity(indexed: DeclarationIndex): readonly ProfileFinding[] {
  const sectionIds = indexed.sections.map(sectionIdOf);
  return indexed.sections.flatMap((section, index) =>
    duplicateFinding(section, sectionIds.slice(0, index)),
  );
}

/** A section id an earlier section already uses is a duplicate; a section without an id is not. */
function duplicateFinding(
  section: Declaration,
  earlier: readonly (SectionId | undefined)[],
): readonly ProfileFinding[] {
  const sectionId = sectionIdOf(section);
  if (sectionId === undefined || !earlier.includes(sectionId)) return [];
  return [
    fieldFinding(section, 'id', {
      code: 'duplicate-section',
      path: `section @${sectionId}`,
      message: 'Section ID is duplicated.',
    }),
  ];
}
