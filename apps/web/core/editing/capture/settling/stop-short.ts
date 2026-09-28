/*
 * A node dropped onto a sibling stops short along its drag path, keeping a padding-wide gap;
 * entering another group takes the nearest free spot there. Pure.
 */
import type {
  Placement,
  RenderDocument,
  Section,
  Target,
} from '../../../../contract/records/owners.js';
import type { SceneNode, SceneSection } from '../scene.js';
import type { Box, Drop, DropGeometry, Point, Size } from './types.js';

/** A dropped node stops short of its siblings along its drag path. */
export function stopShort(
  section: Section,
  document: RenderDocument,
  targets: readonly Target[],
): Section {
  const scene = document.scene.sections.find((item) => item.id === section.id);
  if (scene === undefined) return section;
  const appearances = targets.reduce(
    (current, target) => stopOneShort(section, scene, current, target, document.options.padding),
    section.appearances,
  );
  return appearances === section.appearances ? section : { ...section, appearances };
}

/** One dropped node stops short of its siblings along its drag path. */
function stopOneShort(
  section: Section,
  scene: SceneSection,
  appearances: Section['appearances'],
  target: Target,
  space: number,
): Section['appearances'] {
  const drop = dropTarget(section, scene, appearances, target);
  if (drop === undefined) return appearances;
  return stopAt(scene, appearances, drop, space);
}

/** The drop of a target, when it names an ungrouped node of this section with a placement. */
function dropTarget(
  section: Section,
  scene: SceneSection,
  appearances: Section['appearances'],
  target: Target,
): Drop | undefined {
  if (target.kind !== 'node' || target.section !== section.id) return undefined;
  return movedDrop(scene, appearances, target.id);
}

/** The drop of one node: it must exist, sit outside groups and have a placed appearance. */
function movedDrop(
  scene: SceneSection,
  appearances: Section['appearances'],
  id: string,
): Drop | undefined {
  const node = scene.nodes.find((item) => item.id === id);
  if (node === undefined || node.measured.groupId !== null) return undefined;
  const moved = appearances.find((a) => a.object === node.measured.objectId);
  if (moved?.placement == null) return undefined;
  return { node, moved, after: moved.placement };
}

/** Move the dropped appearance to the last clear point of its path. */
function stopAt(
  scene: SceneSection,
  appearances: Section['appearances'],
  drop: Drop,
  space: number,
): Section['appearances'] {
  const geometry = dropGeometry(scene, appearances, drop, space);
  if (geometry.clear(1)) return appearances;
  const spot = dropSpot(drop, geometry);
  return appearances.map((a) =>
    a === drop.moved ? { ...a, placement: { ...drop.after, x: spot.x, y: spot.y } } : a,
  );
}

/** The drag path and the sibling boxes it must not overlap. */
function dropGeometry(
  scene: SceneSection,
  appearances: Section['appearances'],
  drop: Drop,
  space: number,
): DropGeometry {
  const parent = frameOf(scene.nodes, drop.node, drop.moved.group);
  const before = {
    x: drop.node.box.x - (parent?.box.x ?? 0),
    y: drop.node.box.y - (parent?.box.y ?? 0),
  };
  const size = {
    width: drop.after.width ?? drop.node.box.width,
    height: drop.after.height ?? drop.node.box.height,
  };
  const others = siblingBoxes(scene, appearances, drop.moved);
  const at = (t: number): Point => ({
    x: before.x + (drop.after.x - before.x) * t,
    y: before.y + (drop.after.y - before.y) * t,
  });
  const free = (p: Point): boolean => others.every((o) => clearOf(p, size, o, space));
  return { at, free, clear: (t) => free(at(t)), entersGroup: parent?.id !== drop.node.parent };
}

/** The boxes of the dropped appearance's siblings in its new group. */
function siblingBoxes(
  scene: SceneSection,
  appearances: Section['appearances'],
  moved: Section['appearances'][number],
): readonly Box[] {
  const siblings = appearances.filter(
    (a): a is Section['appearances'][number] & { readonly placement: Placement } =>
      a !== moved && a.group === moved.group && a.placement != null,
  );
  return siblings.map((a) => siblingBox(scene, a));
}

/** A sibling's box: its placement, with the node's measured size as fallback. */
function siblingBox(
  scene: SceneSection,
  appearance: Section['appearances'][number] & { readonly placement: Placement },
): Box {
  const node = scene.nodes.find((item) => item.measured.objectId === appearance.object);
  const { placement } = appearance;
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width ?? node?.box.width ?? 0,
    height: placement.height ?? node?.box.height ?? 0,
  };
}

/** Two boxes keep a padding-wide gap, on one axis or the other. */
function clearOf(
  p: Point,
  size: Size,
  other: Box,
  space: number,
): boolean {
  return (
    p.x + size.width + space <= other.x ||
    other.x + other.width + space <= p.x ||
    p.y + size.height + space <= other.y ||
    other.y + other.height + space <= p.y
  );
}

/** Along the path inside the same group; entering another group takes the nearest free spot there. */
function dropSpot(
  drop: Drop,
  geometry: DropGeometry,
): Point {
  if (geometry.entersGroup) return nearestFree(drop.after, geometry.free);
  return backTrack(geometry.at, geometry.clear);
}

/** The last clear point of the path, stepping back in sixty-fourths. */
function backTrack(
  at: (t: number) => Point,
  clear: (t: number) => boolean,
): Point {
  let t = 1;
  while (t > 0 && !clear(t)) t = Math.max(0, t - 1 / 64);
  return at(t);
}

/** Search outward from the drop point, down then right. Never up or left: that would leave the group. */
function nearestFree(
  from: Point,
  free: (p: Point) => boolean,
): Point {
  const ways = [
    [0, 1],
    [1, 0],
  ] as const;
  const steps = Array.from({ length: 256 }, (_, i) => (i + 1) * 8);
  const spots = steps.flatMap((d) =>
    ways.map(([x, y]) => ({ x: from.x + x * d, y: from.y + y * d })),
  );
  return spots.find(free) ?? from;
}

/** The frame the node's placement is measured from: its new group, or the nearest non-group ancestor. */
function frameOf(
  nodes: readonly SceneNode[],
  node: SceneNode,
  group: string | undefined,
): SceneNode | undefined {
  if (group !== undefined) return nodes.find((item) => item.measured.groupId === group);
  return outside(
    nodes,
    nodes.find((item) => item.id === node.parent),
  );
}

/** The nearest ancestor outside any group. */
function outside(
  nodes: readonly SceneNode[],
  from: SceneNode | undefined,
): SceneNode | undefined {
  if (from?.measured.groupId == null) return from;
  return outside(
    nodes,
    nodes.find((item) => item.id === from.parent),
  );
}
