/*
 * Pinning placements at capture time: every section keeps its place, and affected module sections
 * also pin every group and appearance, so a drag measures from where things were. A scene that no
 * longer mirrors the collection is a typed `stale-target` failure, never a throw. Pure; Authoring
 * owns commit and recovery.
 */
import type { Result } from '../../../contract/errors.js';
import { failure } from '../../../contract/errors.js';
import type {
  Placement,
  PlacementIntent,
  RenderDocument,
  Section,
} from '../../../contract/records/owners.js';
import type { SceneNode, SceneSection } from './scene.js';
import { mapResults } from '../results.js';

/** A node's placement as captured, keeping a prior lock. */
export function sourcePlacement(
  prior: Placement | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): Placement {
  return {
    x,
    y,
    width,
    height,
    locked: prior?.locked ?? false,
  };
}

/** A section's placement measured from the scene origin, keeping the rest of a prior placement. */
export function originPlacement(
  prior: Placement | undefined,
  x: number,
  y: number,
): Placement {
  return prior === undefined ? { x, y, locked: false } : { ...prior, x, y };
}

/** Every section pinned, with the intent's target sections pinned down to groups and nodes. */
export function pinnedSections(
  document: RenderDocument,
  intent: PlacementIntent,
): Result<readonly Section[]> {
  return pinnedFor(document, affectedSections(intent));
}

/** Every section keeps its place; sections in `affected` also keep every group and node in place. */
export function pinnedFor(
  document: RenderDocument,
  affected: ReadonlySet<string>,
): Result<readonly Section[]> {
  return mapResults(document.collection.sections, (source) =>
    pinSection(document, source, affected),
  );
}

/** The section IDs a placement intent touches: named sections and the sections of named nodes. */
function affectedSections(intent: PlacementIntent): ReadonlySet<string> {
  const ids = intent.entries.map((entry) => affectedId(entry.target));
  return new Set(ids.filter((id) => id !== ''));
}

/** The section a target names, or '' for a target with none. */
function affectedId(target: PlacementIntent['entries'][number]['target']): string {
  if (target.kind === 'section') return target.id;
  if (target.kind === 'node') return target.section;
  return '';
}

/** One pinned section; only affected module sections pin their contents. */
function pinSection(
  document: RenderDocument,
  source: Section,
  affected: ReadonlySet<string>,
): Result<Section> {
  const scene = document.scene.sections.find((item) => item.id === source.id);
  if (scene === undefined) {
    return failure('stale-target', 'The captured section is no longer in the scene');
  }
  const placement = originPlacement(source.placement, scene.origin.x, scene.origin.y);
  if (!affected.has(source.id) || source.mode !== 'modules') {
    return { ok: true, value: { ...source, placement } };
  }
  return pinContents(source, scene, placement);
}

/** A module section with every group and appearance pinned to its scene box. */
function pinContents(
  source: Section,
  scene: SceneSection,
  placement: Placement,
): Result<Section> {
  const indexed = new Map(scene.nodes.map((node) => [node.id, node]));
  const groups = mapResults(source.groups, (group) => pinGroup(group, scene.nodes, indexed));
  if (!groups.ok) {
    return groups;
  }
  const appearances = mapResults(source.appearances, (appearance) =>
    pinAppearance(appearance, scene.nodes, indexed),
  );
  if (!appearances.ok) {
    return appearances;
  }
  return {
    ok: true,
    value: { ...source, placement, groups: groups.value, appearances: appearances.value },
  };
}

/** A group pinned to its scene box, relative to its parent node. */
function pinGroup(
  group: Section['groups'][number],
  nodes: readonly SceneNode[],
  indexed: ReadonlyMap<string, SceneNode>,
): Result<Section['groups'][number]> {
  const node = nodes.find((candidate) => candidate.measured.groupId === group.id);
  if (node === undefined) {
    return failure('stale-target', 'The captured group is no longer in the scene');
  }
  const placement = scenePlacement(group.placement, node, indexed);
  if (!placement.ok) {
    return placement;
  }
  return { ok: true, value: { ...group, placement: placement.value } };
}

/** An appearance pinned to its scene box, relative to its parent node. */
function pinAppearance(
  appearance: Section['appearances'][number],
  nodes: readonly SceneNode[],
  indexed: ReadonlyMap<string, SceneNode>,
): Result<Section['appearances'][number]> {
  const node = nodes.find(
    (candidate) =>
      candidate.measured.groupId === null && candidate.measured.objectId === appearance.object,
  );
  if (node === undefined) {
    return failure('stale-target', 'The captured appearance is no longer in the scene');
  }
  const placement = scenePlacement(appearance.placement, node, indexed);
  if (!placement.ok) {
    return placement;
  }
  return { ok: true, value: { ...appearance, placement: placement.value } };
}

/** A member's placement measured from its parent node's box. */
function scenePlacement(
  prior: Placement | undefined,
  node: SceneNode,
  indexed: ReadonlyMap<string, SceneNode>,
): Result<Placement> {
  const parent = parentBox(node, indexed);
  if (node.parent !== null && parent === undefined) {
    return failure('stale-target', 'The captured parent is no longer in the scene');
  }
  return {
    ok: true,
    value: sourcePlacement(
      prior,
      node.box.x - (parent?.x ?? 0),
      node.box.y - (parent?.y ?? 0),
      node.box.width,
      node.box.height,
    ),
  };
}

/** The box of a node's parent; undefined for a root node. */
function parentBox(
  node: SceneNode,
  indexed: ReadonlyMap<string, SceneNode>,
) {
  return node.parent === null ? undefined : indexed.get(node.parent)?.box;
}
