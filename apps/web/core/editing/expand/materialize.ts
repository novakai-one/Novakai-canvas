/*
 * Materializing an expansion: the planned sections take the grown sizes — the section's own
 * placement gains the new width and height, and each grown group's placement is rewritten
 * relative to its parent. Only the target section changes.
 */
import type { RenderDocument, Section } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import { changes, plannedSections } from '../capture/settling/sections.js';
import { sourcePlacement } from '../capture/pinning.js';
import { parentNode } from '../capture/scene.js';
import type {
  ExpansionGeometry,
  ExpansionPreparation,
  MaterializedExpansion,
  SectionGroup,
} from './types.js';

/** Write the expansion into the planned sections and diff the result into replace changes. */
export function materializeExpansion(
  prepared: ExpansionPreparation,
  geometry: ExpansionGeometry,
  document: RenderDocument,
): Result<MaterializedExpansion> {
  const planned = plannedSections(document, prepared.intent);
  if (!planned.ok) return planned;
  const sections = planned.value.map((candidate) =>
    expandSection(candidate, prepared, geometry, document),
  );
  return { ok: true, value: { sections, changes: changes(document, sections) } };
}

/** Other sections pass through; the target section takes the grown size and groups. */
function expandSection(
  candidate: Section,
  prepared: ExpansionPreparation,
  geometry: ExpansionGeometry,
  document: RenderDocument,
): Section {
  if (candidate.id !== prepared.sceneSection.id) return candidate;
  const sectionSource = document.collection.sections.find(
    (item) => item.id === prepared.sceneSection.id,
  );
  if (sectionSource === undefined) return candidate;
  return {
    ...candidate,
    placement: sourcePlacement(
      sectionSource.placement,
      prepared.sceneSection.origin.x,
      prepared.sceneSection.origin.y,
      geometry.sectionWidth,
      geometry.sectionHeight,
    ),
    groups: candidate.groups.map((group) => expandGroup(group, prepared, geometry)),
  };
}

/** A grown group takes its new size; every other group is unchanged. */
function expandGroup(
  group: SectionGroup,
  prepared: ExpansionPreparation,
  geometry: ExpansionGeometry,
): SectionGroup {
  const change = geometry.expanded.get(group.id);
  if (change === undefined) return group;
  const parent = parentNode(prepared.sceneSection, change.node);
  return {
    ...group,
    placement: sourcePlacement(
      group.placement,
      change.node.box.x - (parent?.box.x ?? 0),
      change.node.box.y - (parent?.box.y ?? 0),
      change.width,
      change.height,
    ),
  };
}
