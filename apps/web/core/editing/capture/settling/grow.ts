/*
 * A child dragged past its group's top or left edge grows the group up or left; the child stays
 * where dropped, and growth is capped by the free room beside and above the group. Pure.
 */
import type { Placement, RenderDocument, Section } from '../../../../contract/records/owners.js';
import type { SceneNode, SceneSection } from '../scene.js';
import type { Growth, GrowthState, Point } from './types.js';

/** A child dragged past its group's top or left edge grows the group up or left; the child stays where dropped. */
export function growToHold(
  section: Section,
  document: RenderDocument,
): Section {
  const scene = document.scene.sections.find((item) => item.id === section.id);
  if (scene === undefined) return section;
  const initial: GrowthState = { groups: section.groups, appearances: section.appearances };
  const grown = deepestFirst(section.groups).reduce(
    (state, group) => growGroup(state, group, scene, document.options.padding),
    initial,
  );
  return grown.groups === section.groups ? section : { ...section, ...grown };
}

/** Deepest groups first, so a parent's growth accounts for already-grown children. */
function deepestFirst(groups: Section['groups']): Section['groups'] {
  return groups.toSorted((a, b) => groupDepth(groups, b.id) - groupDepth(groups, a.id));
}

/** The nesting depth of a group; orphan parents count as roots. */
function groupDepth(
  groups: Section['groups'],
  id: string | undefined,
): number {
  const parent = groups.find((g) => g.id === id)?.parent;
  return parent == null ? 0 : 1 + groupDepth(groups, parent);
}

/** One group's growth step; groups without a placement or measured header are left alone. */
function growGroup(
  state: GrowthState,
  group: Section['groups'][number],
  scene: SceneSection,
  padding: number,
): GrowthState {
  const current = state.groups.find((g) => g.id === group.id);
  const header = scene.nodes.find((n) => n.measured.groupId === group.id)?.measured.headerHeight;
  if (current?.placement == null || header === undefined) return state;
  return growMeasured(state, group, current.placement, header, scene, padding);
}

/** A group grows only when it has children. */
function growMeasured(
  state: GrowthState,
  group: Section['groups'][number],
  placement: Placement,
  header: number,
  scene: SceneSection,
  padding: number,
): GrowthState {
  const children = childPlacements(state, group.id);
  if (children.length === 0) return state;
  return applyNeeded(state, group, placement, children, scene, header, padding);
}

/** Growth is applied only when the children sit past the inset. */
function applyNeeded(
  state: GrowthState,
  group: Section['groups'][number],
  placement: Placement,
  children: readonly Placement[],
  scene: SceneSection,
  header: number,
  padding: number,
): GrowthState {
  const growth = neededGrowth(group, placement, children, scene, header, padding);
  if (growth.dx === 0 && growth.dy === 0) return state;
  return applyGrowth(state, group.id, placement, growth);
}

/** The placements of the group's member appearances and child groups. */
function childPlacements(
  state: GrowthState,
  id: string,
): Placement[] {
  const members = state.appearances.filter((a) => a.group === id).map((a) => a.placement);
  const subgroups = state.groups.filter((g) => g.parent === id).map((g) => g.placement);
  return [...members, ...subgroups].filter((p): p is Placement => p != null);
}

/** How far the group must grow so its children sit inside the inset, capped by the free room. */
function neededGrowth(
  group: Section['groups'][number],
  placement: Placement,
  children: readonly Placement[],
  scene: SceneSection,
  header: number,
  padding: number,
): Growth {
  const frame = scene.nodes.find((n) => n.measured.groupId === group.id);
  const inset = groupInset(scene, frame, header, padding);
  const needX = Math.max(0, inset.x - Math.min(...children.map((p) => p.x)));
  const needY = Math.max(0, inset.y - Math.min(...children.map((p) => p.y)));
  const room = frame === undefined ? { x: 0, y: 0 } : freeRoom(scene.nodes, frame);
  const top = group.parent == null;
  return {
    dx: cappedGrowth(needX, room.x, placement.x, top, padding),
    dy: cappedGrowth(needY, room.y, placement.y, top, padding),
    insetX: inset.x,
    insetY: inset.y,
  };
}

/** The inset the layout already gave this group; its frame road runs inside it. */
function groupInset(
  scene: SceneSection,
  frame: SceneNode | undefined,
  header: number,
  padding: number,
): Point {
  const inside = frame === undefined ? [] : scene.nodes.filter((n) => n.parent === frame.id);
  if (frame === undefined || inside.length === 0) return { x: padding, y: header + padding };
  return {
    x: Math.max(padding, Math.min(...inside.map((n) => n.box.x - frame.box.x))),
    y: Math.max(header + padding, Math.min(...inside.map((n) => n.box.y - frame.box.y))),
  };
}

/** Growth along one axis: into free room, and at the top level never past the padding. */
function cappedGrowth(
  need: number,
  room: number,
  position: number,
  topLevel: boolean,
  padding: number,
): number {
  const edge = topLevel ? Math.min(room, position - padding) : room;
  return Math.min(need, Math.max(0, edge));
}

/** Grow the group up and left, shifting its members and child groups back inside the inset. */
function applyGrowth(
  state: GrowthState,
  id: string,
  placement: Placement,
  growth: Growth,
): GrowthState {
  const groups = state.groups.map((g) => grownGroup(g, id, placement, growth));
  const appearances = state.appearances.map((a) =>
    a.group === id ? { ...a, placement: shiftInside(a.placement, growth) } : a,
  );
  return { groups, appearances };
}

/** The group itself grows; its child groups shift; every other group is unchanged. */
function grownGroup(
  g: Section['groups'][number],
  id: string,
  placement: Placement,
  growth: Growth,
): Section['groups'][number] {
  if (g.id === id) return { ...g, placement: grownSelf(placement, growth) };
  if (g.parent === id) return { ...g, placement: shiftInside(g.placement, growth) };
  return g;
}

/** The group grows up and left, wider and taller by the same amount. */
function grownSelf(
  placement: Placement,
  growth: Growth,
): Placement {
  return {
    ...placement,
    x: placement.x - growth.dx,
    y: placement.y - growth.dy,
    width: grownDimension(placement.width, growth.dx),
    height: grownDimension(placement.height, growth.dy),
  };
}

/** A dimension grown by delta; undefined stays unset. */
function grownDimension(
  value: number | undefined,
  delta: number,
): number | undefined {
  return value === undefined ? undefined : value + delta;
}

/** A child shifted right and down by the growth, never past the inset. */
function shiftInside(
  placement: Placement | undefined,
  growth: Growth,
): Placement | undefined {
  if (placement == null) return placement;
  return {
    ...placement,
    x: Math.max(growth.insetX, placement.x + growth.dx),
    y: Math.max(growth.insetY, placement.y + growth.dy),
  };
}

/** Space left of and above a group it may grow into. */
function freeRoom(
  nodes: readonly SceneNode[],
  frame: SceneNode,
): Point {
  const b = frame.box;
  const siblings = nodes.filter((n) => n.parent === frame.parent && n.id !== frame.id);
  const left = siblings.filter(
    (n) => n.box.x + n.box.width <= b.x && n.box.y < b.y + b.height && b.y < n.box.y + n.box.height,
  );
  const above = siblings.filter(
    (n) => n.box.y + n.box.height <= b.y && n.box.x < b.x + b.width && b.x < n.box.x + n.box.width,
  );
  return {
    // The road beside a sibling is already at its minimum width; never grow into it.
    x: left.length > 0 ? 0 : Infinity,
    y: above.length > 0 ? 0 : Infinity,
  };
}
