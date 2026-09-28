/*
 * Releasing a section for rearrangement: the selected node takes its requested placement, its
 * closure keeps source-relative placements, and everything else is unpinned so the native reflow
 * can move it. A captured node missing from the scene is a `stale-target` failure, never a throw.
 */
import type { RenderDocument, Section } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import { failure } from '../../../contract/errors.js';
import { mapResults } from '../results.js';
import { changes } from '../capture/settling/sections.js';
import { pinnedSections, sourcePlacement } from '../capture/pinning.js';
import { parentNode } from '../capture/scene.js';
import type { SceneNode, SceneSection } from '../capture/scene.js';
import type {
  RearrangementPreparation,
  ReleasedCandidate,
  SectionAppearance,
  SectionGroup,
} from './types.js';

/**
 * Release every section's placements implied by the intent; only the target section changes.
 *
 * A pinned section that cannot settle fails as `stale-target`; a captured group or appearance
 * missing from the scene does the same.
 */
export function releaseRearrangement(
  prepared: RearrangementPreparation,
  document: RenderDocument,
): Result<ReleasedCandidate> {
  const frozen = pinnedSections(document, prepared.intent);
  return frozen.ok ? releaseSections(frozen.value, prepared, document) : frozen;
}

/** Release each pinned section, then diff the released list into replace changes. */
function releaseSections(
  sections: readonly Section[],
  prepared: RearrangementPreparation,
  document: RenderDocument,
): Result<ReleasedCandidate> {
  const candidate = mapResults(sections, (section) => releaseSection(section, prepared));
  return candidate.ok
    ? {
        ok: true,
        value: { sections: candidate.value, changes: changes(document, candidate.value) },
      }
    : candidate;
}

/** Other sections pass through; the target section's groups and appearances are released. */
function releaseSection(
  section: Section,
  prepared: RearrangementPreparation,
): Result<Section> {
  return section.id === prepared.sectionId
    ? releaseContents(section, prepared)
    : { ok: true, value: section };
}

/** Release the target section's groups and appearances. */
function releaseContents(
  section: Section,
  prepared: RearrangementPreparation,
): Result<Section> {
  const groups = mapResults(section.groups, (group) => releaseGroup(group, prepared));
  if (!groups.ok) return groups;
  const appearances = mapResults(section.appearances, (appearance) =>
    releaseAppearance(appearance, prepared),
  );
  return appearances.ok
    ? { ok: true, value: { ...section, groups: groups.value, appearances: appearances.value } }
    : appearances;
}

/** Release one group's placement from its measured scene node. */
function releaseGroup(
  group: SectionGroup,
  prepared: RearrangementPreparation,
): Result<SectionGroup> {
  const node = prepared.scene.nodes.find((item) => item.measured.groupId === group.id);
  if (node === undefined)
    return failure('stale-target', 'The rearrangement scene is missing a captured group');
  const parent = parentNode(prepared.scene, node);
  return { ok: true, value: releaseGroupPlacement(group, node, parent, prepared) };
}

/** The selected group takes the requested placement; its closure keeps source positions. */
function releaseGroupPlacement(
  group: SectionGroup,
  node: SceneNode,
  parent: SceneNode | undefined,
  prepared: RearrangementPreparation,
): SectionGroup {
  if (node.measured.groupId === prepared.selectedGroupId)
    return selectedGroupPlacement(group, node, prepared);
  return isInSelectedClosure(node, prepared)
    ? {
        ...group,
        placement: sourcePlacement(
          group.placement,
          node.box.x - (parent?.box.x ?? 0),
          node.box.y - (parent?.box.y ?? 0),
          node.box.width,
          node.box.height,
        ),
      }
    : { ...group, placement: undefined };
}

/** The selected group is placed where the intent asks. */
function selectedGroupPlacement(
  group: SectionGroup,
  node: SceneNode,
  prepared: RearrangementPreparation,
): SectionGroup {
  return {
    ...group,
    placement: sourcePlacement(
      group.placement,
      prepared.entry.placement.x,
      prepared.entry.placement.y,
      node.box.width,
      node.box.height,
    ),
  };
}

/** Release one appearance's placement from its measured scene node. */
function releaseAppearance(
  appearance: SectionAppearance,
  prepared: RearrangementPreparation,
): Result<SectionAppearance> {
  const node = prepared.scene.nodes.find(
    (item) => item.measured.groupId === null && item.measured.objectId === appearance.object,
  );
  if (node === undefined)
    return failure('stale-target', 'The rearrangement scene is missing a captured appearance');
  const parent = parentNode(prepared.scene, node);
  return { ok: true, value: releaseAppearancePlacement(appearance, node, parent, prepared) };
}

/** An ungrouped selected node is placed by the intent; every other appearance is preserved. */
function releaseAppearancePlacement(
  appearance: SectionAppearance,
  node: SceneNode,
  parent: SceneNode | undefined,
  prepared: RearrangementPreparation,
): SectionAppearance {
  return node.id === prepared.selected.id && prepared.selectedGroupId === null
    ? selectedAppearancePlacement(appearance, node, prepared)
    : preservedAppearancePlacement(appearance, node, parent, prepared);
}

/** The selected node's appearance is placed where the intent asks. */
function selectedAppearancePlacement(
  appearance: SectionAppearance,
  node: SceneNode,
  prepared: RearrangementPreparation,
): SectionAppearance {
  return {
    ...appearance,
    placement: sourcePlacement(
      appearance.placement,
      prepared.entry.placement.x,
      prepared.entry.placement.y,
      node.box.width,
      node.box.height,
    ),
  };
}

/** Closure members keep source-relative placements; outsiders are unpinned for the reflow. */
function preservedAppearancePlacement(
  appearance: SectionAppearance,
  node: SceneNode,
  parent: SceneNode | undefined,
  prepared: RearrangementPreparation,
): SectionAppearance {
  return isInSelectedClosure(node, prepared) || prepared.ancestors.has(node.parent ?? '')
    ? {
        ...appearance,
        placement: sourcePlacement(
          appearance.placement,
          node.box.x - (parent?.box.x ?? 0),
          node.box.y - (parent?.box.y ?? 0),
          node.box.width,
          node.box.height,
        ),
      }
    : { ...appearance, placement: undefined };
}

/** A node is in the closure when it is the selected node, an ancestor, or below the selected one. */
function isInSelectedClosure(
  node: SceneNode,
  prepared: RearrangementPreparation,
): boolean {
  if (node.id === prepared.selected.id || prepared.ancestors.has(node.id)) return true;
  return hasSelectedAncestor(prepared.scene, node.parent, prepared.selected.id);
}

/** Walk the parent chain looking for the selected node. */
function hasSelectedAncestor(
  scene: SceneSection,
  initial: string | null,
  selected: string,
): boolean {
  let current = initial;
  let found = false;
  while (current !== null && !found) {
    found = current === selected;
    current = scene.nodes.find((item) => item.id === current)?.parent ?? null;
  }
  return found;
}
