/*
 * Computing expansion geometry: the drop's required corner walks up the ancestor chain, growing
 * each group that is too small, and the section itself grows when the requirement passes its
 * edge. Pure; no document writes happen here.
 */
import { parentNode } from '../capture/scene.js';
import type { SceneNode, SceneSection } from '../capture/scene.js';
import type {
  AncestorGrowth,
  ExpandedGroup,
  ExpansionGeometry,
  ExpansionPreparation,
} from './types.js';

/**
 * Walk the ancestor chain from the dragged node's parent to the root, growing each group to
 * hold the requirement, then compute the section's new size. Null when nothing needs to grow.
 */
export function computeExpansion(prepared: ExpansionPreparation): ExpansionGeometry | null {
  const expanded = new Map<string, ExpandedGroup>();
  let ancestor = prepared.parent;
  let requiredRight =
    prepared.before.x - prepared.sceneSection.origin.x + prepared.dx + prepared.before.width;
  let requiredBottom =
    prepared.before.y - prepared.sceneSection.origin.y + prepared.dy + prepared.before.height;
  while (ancestor !== undefined) {
    const growth = growAncestor(prepared.sceneSection, ancestor, requiredRight, requiredBottom);
    requiredRight = growth.requiredRight;
    requiredBottom = growth.requiredBottom;
    recordGroup(expanded, growth);
    ancestor = growth.parent;
  }
  return computeExpandedSection(prepared.sceneSection, expanded, requiredRight, requiredBottom);
}

/** Record a grown group by its id; ungrouped ancestors contribute no group. */
function recordGroup(
  expanded: Map<string, ExpandedGroup>,
  growth: AncestorGrowth,
): void {
  if (growth.group !== undefined) expanded.set(growth.group.id, growth.group);
}

/** Grow one ancestor to hold the requirement, keeping the room its children already reserve. */
function growAncestor(
  section: SceneSection,
  ancestor: SceneNode,
  requiredRight: number,
  requiredBottom: number,
): AncestorGrowth {
  const children = section.nodes.filter((item) => item.parent === ancestor.id);
  const childRight = children.reduce(
    (value, item) => Math.max(value, item.box.x + item.box.width),
    ancestor.box.x,
  );
  const childBottom = children.reduce(
    (value, item) => Math.max(value, item.box.y + item.box.height),
    ancestor.box.y,
  );
  const rightReserve = ancestor.box.x + ancestor.box.width - childRight;
  const bottomReserve = ancestor.box.y + ancestor.box.height - childBottom;
  const width = Math.max(ancestor.box.width, requiredRight - ancestor.box.x + rightReserve);
  const height = Math.max(ancestor.box.height, requiredBottom - ancestor.box.y + bottomReserve);
  return {
    requiredRight: Math.max(requiredRight, ancestor.box.x + width),
    requiredBottom: Math.max(requiredBottom, ancestor.box.y + height),
    group: expandedGroup(ancestor, width, height),
    parent: parentNode(section, ancestor),
  };
}

/** The grown group record; ancestors outside any group contribute none. */
function expandedGroup(
  ancestor: SceneNode,
  width: number,
  height: number,
): ExpandedGroup | undefined {
  const id = ancestor.measured.groupId;
  return id === null ? undefined : { id, node: ancestor, width, height };
}

/** The section's new size, or null when neither a group nor the section needs to grow. */
function computeExpandedSection(
  sceneSection: SceneSection,
  expanded: ReadonlyMap<string, ExpandedGroup>,
  requiredRight: number,
  requiredBottom: number,
): ExpansionGeometry | null {
  const groupGrowth = [...expanded.values()].some(
    ({ node, width, height }) => width !== node.box.width || height !== node.box.height,
  );
  const sectionLocalX = sceneSection.box.x - sceneSection.origin.x;
  const sectionLocalY = sceneSection.box.y - sceneSection.origin.y;
  const sectionNeedsGrowth =
    requiredRight > sectionLocalX + sceneSection.box.width ||
    requiredBottom > sectionLocalY + sceneSection.box.height;
  if (!groupGrowth && !sectionNeedsGrowth) return null;
  return expandedSection(sceneSection, expanded, requiredRight, requiredBottom);
}

/** Size the section to hold the current contents, the requirement and every grown group. */
function expandedSection(
  sceneSection: SceneSection,
  expanded: ReadonlyMap<string, ExpandedGroup>,
  requiredRight: number,
  requiredBottom: number,
): ExpansionGeometry {
  const sectionLocalX = sceneSection.box.x - sceneSection.origin.x;
  const sectionLocalY = sceneSection.box.y - sceneSection.origin.y;
  const currentRight = sceneSection.nodes.reduce(
    (value, item) => Math.max(value, item.box.x + item.box.width),
    0,
  );
  const currentBottom = sceneSection.nodes.reduce(
    (value, item) => Math.max(value, item.box.y + item.box.height),
    0,
  );
  const rightReserve = sectionLocalX + sceneSection.box.width - currentRight;
  const bottomReserve = sectionLocalY + sceneSection.box.height - currentBottom;
  const expandedRight = Math.max(
    currentRight,
    requiredRight,
    ...[...expanded.values()].map(({ node, width }) => node.box.x + width),
  );
  const expandedBottom = Math.max(
    currentBottom,
    requiredBottom,
    ...[...expanded.values()].map(({ node, height }) => node.box.y + height),
  );
  return {
    expanded,
    requiredRight,
    requiredBottom,
    sectionWidth: Math.max(sceneSection.box.width, expandedRight + rightReserve),
    sectionHeight: Math.max(sceneSection.box.height, expandedBottom + bottomReserve),
  };
}
