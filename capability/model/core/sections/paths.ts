import type { Section } from '../../contract/records/section.js';

/**
 * Returns a section's diagnostic path, `sections.<id>`. Reads `section.id` once. Longer paths
 * append to it, for example `${sectionPath(section)}.appearances.<object>`.
 *
 * @param section - The section (only its ID is read).
 * @returns The path text.
 */
export function sectionPath(section: Pick<Section, 'id'>): string {
  return `sections.${section.id}`;
}
