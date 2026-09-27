import type { PrototypeBounds, PrototypeRoad } from '../contract/records/road-prototype.js';
import type { NestedSupportConstraint } from '../contract/records/nested-support.js';
import type { SectionPlacement } from './prototype-nested-placement.js';
import { axes } from './prototype-road-geometry.js';
import {
  anchor,
  equate,
  relate,
  reject,
  required,
  type Anchor,
  type SupportGraph,
} from './nested-support-graph.js';
import type { retainSupportInput } from './nested-support-input.js';

type Input = ReturnType<typeof retainSupportInput>;
type Axis = Anchor['axis'];
const dimensions = { x: 'width', y: 'height' } as const;

/** Construction aliases collapse only shared spans/contact endpoints, not coincident objects. */
export function supportStructure(
  graph: SupportGraph,
  input: Input,
) {
  const lines = new Map<string, Anchor>();
  input.populations.forEach((p) => {
    const road = required(input.final, p.roadId),
      a = axes[road.axis];
    const line = anchor(graph, p.key, a.across, road.bounds[a.across] + road.bounds[a.breadth] / 2);
    p.origins.forEach((origin) => lines.set(origin, line));
    lines.set(road.id, line);
  });
  const widths = new Map(input.populations.map((p) => [p.key, p.width / 2]));
  input.placements.forEach((p) => sectionTracks(graph, lines, p, input));
  input.placements.forEach((p) => outsideSupports(graph, lines, widths, p));
  input.roads
    .filter((r) => r.kind === 'street')
    .forEach((r) => streetEnvelope(graph, lines, r, input));
  return lines;
}
function outsideSupports(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  widths: ReadonlyMap<string, number>,
  p: SectionPlacement,
): void {
  if (p.section.parentSectionId === null) rootSupports(graph, lines, widths, p);
  p.size.children.forEach((child, ordinal) => {
    const lowX = childBoundary(lines, p, ordinal);
    const highX = required(lines, `${p.section.id}:child-boundary:${ordinal}`);
    excludedBody(graph, widths, child.id, 'x', lowX, highX);
    excludedBody(
      graph,
      widths,
      child.id,
      'y',
      frameLine(lines, p.section.id, 'frame', 'y', false),
      frameLine(lines, p.section.id, 'frame', 'y', true),
    );
  });
}
function rootSupports(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  widths: ReadonlyMap<string, number>,
  p: SectionPlacement,
): void {
  (['x', 'y'] as const).forEach((axis) =>
    excludedBody(
      graph,
      widths,
      p.section.id,
      axis,
      frameLine(lines, p.section.id, 'surrounding', axis, false),
      frameLine(lines, p.section.id, 'surrounding', axis, true),
    ),
  );
}
function childBoundary(
  lines: ReadonlyMap<string, Anchor>,
  p: SectionPlacement,
  ordinal: number,
): Anchor {
  if (ordinal > 0) return required(lines, `${p.section.id}:child-boundary:${ordinal - 1}`);
  return cellLine(lines, p, 'x', p.size.columns, p.size.columns);
}
function excludedBody(
  graph: SupportGraph,
  widths: ReadonlyMap<string, number>,
  id: string,
  axis: Axis,
  low: Anchor,
  high: Anchor,
): void {
  relate(
    graph,
    low,
    required(graph.anchors, `${id}:${axis}:low`),
    required(widths, low.key),
    'structure',
    [id, low.key],
  );
  relate(
    graph,
    required(graph.anchors, `${id}:${axis}:high`),
    high,
    required(widths, high.key),
    'structure',
    [id, high.key],
  );
}
function boundsAnchor(
  graph: SupportGraph,
  id: string,
  b: PrototypeBounds,
  axis: Axis,
  high: boolean,
): Anchor {
  const offset = high ? b[dimensions[axis]] : 0;
  return anchor(graph, `${id}:${axis}:${high ? 'high' : 'low'}`, axis, b[axis] + offset);
}
function sectionTracks(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  p: SectionPlacement,
  input: Input,
): void {
  const section = input.sections.get(p.section.id);
  if (section === undefined) return reject('missing-contact', [p.section.id]);
  (['x', 'y'] as const).forEach((axis) => sectionAxis(graph, lines, p, section.bounds, axis));
  p.nodes.forEach((node, ordinal) => {
    const actual = input.nodes.get(node.id);
    if (actual === undefined) return reject('missing-contact', [node.id]);
    const column = ordinal % p.size.columns,
      row = Math.floor(ordinal / p.size.columns);
    bodyCell(graph, lines, p, actual.id, actual.bounds, 'x', column, p.size.columns);
    bodyCell(graph, lines, p, actual.id, actual.bounds, 'y', row, p.size.rows);
  });
}
function orientation(axis: Axis) {
  return axis === 'x' ? 'vertical' : 'horizontal';
}
function frameLine(
  lines: ReadonlyMap<string, Anchor>,
  id: string,
  frame: string,
  axis: Axis,
  high: boolean,
): Anchor {
  return required(lines, `${id}:${frame}:${orientation(axis)}:${high ? 1 : 0}`);
}
function sectionAxis(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  p: SectionPlacement,
  bounds: PrototypeBounds,
  axis: Axis,
): void {
  const low = boundsAnchor(graph, p.section.id, bounds, axis, false),
    high = boundsAnchor(graph, p.section.id, bounds, axis, true);
  const insideLow = frameLine(lines, p.section.id, 'frame', axis, false),
    insideHigh = frameLine(lines, p.section.id, 'frame', axis, true);
  // Amendment 1: moving the low wall must never contract the retained section extent.
  relate(graph, low, high, bounds[dimensions[axis]], 'structure', [p.section.id, 'grow-only']);
  relate(graph, low, insideLow, 0, 'structure', [p.section.id]);
  relate(graph, insideLow, insideHigh, 0, 'structure', [p.section.id]);
  relate(graph, insideHigh, high, 0, 'structure', [p.section.id]);
  surround(graph, lines, p, axis, low, high);
}
function surround(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  p: SectionPlacement,
  axis: Axis,
  low: Anchor,
  high: Anchor,
): void {
  if (p.section.parentSectionId === null) {
    relate(graph, frameLine(lines, p.section.id, 'surrounding', axis, false), low, 0, 'structure', [
      p.section.id,
    ]);
    relate(graph, high, frameLine(lines, p.section.id, 'surrounding', axis, true), 0, 'structure', [
      p.section.id,
    ]);
    return;
  }
  const parent = p.section.parentSectionId;
  if (parent === undefined) return reject('unsupported-support', [p.section.id]);
  relate(graph, required(graph.anchors, `${parent}:${axis}:low`), low, 0, 'structure', [
    parent,
    p.section.id,
  ]);
  relate(graph, high, required(graph.anchors, `${parent}:${axis}:high`), 0, 'structure', [
    parent,
    p.section.id,
  ]);
}
function cellLine(
  lines: ReadonlyMap<string, Anchor>,
  p: SectionPlacement,
  axis: Axis,
  ordinal: number,
  count: number,
): Anchor {
  if (ordinal === 0) return frameLine(lines, p.section.id, 'frame', axis, false);
  return interiorLine(lines, p, axis, ordinal, count);
}
function interiorLine(
  lines: ReadonlyMap<string, Anchor>,
  p: SectionPlacement,
  axis: Axis,
  ordinal: number,
  count: number,
): Anchor {
  if ([axis === 'y', ordinal === count].every(Boolean))
    return frameLine(lines, p.section.id, 'frame', axis, true);
  const family = axis === 'x' ? 'column' : 'row';
  return required(lines, `${p.section.id}:${family}:${ordinal - 1}`);
}
function bodyCell(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  p: SectionPlacement,
  id: string,
  b: PrototypeBounds,
  axis: Axis,
  ordinal: number,
  count: number,
): void {
  const center = anchor(graph, `${id}:${axis}:center`, axis, b[axis] + b[dimensions[axis]] / 2);
  const track = anchor(graph, `${p.section.id}:${axis}:track:${ordinal}`, axis, center.position);
  equate(graph, track, center);
  const low = cellLine(lines, p, axis, ordinal, count),
    high = cellLine(lines, p, axis, ordinal + 1, count);
  relate(graph, low, center, b[dimensions[axis]] / 2, 'structure', [id]);
  relate(graph, center, high, b[dimensions[axis]] / 2, 'structure', [id]);
}
function streetEnvelope(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  template: PrototypeRoad,
  input: Input,
): void {
  const road = required(input.final, template.id),
    a = axes[road.axis];
  const center = required(lines, road.id);
  const ends = [false, true].map((high) => streetEnd(graph, lines, template, high, input));
  const section = input.sections.get(road.sectionId ?? '');
  if (section === undefined) return;
  const low = boundsAnchor(graph, section.id, section.bounds, a.across, false),
    high = boundsAnchor(graph, section.id, section.bounds, a.across, true);
  const half = road.bounds[a.breadth] / 2;
  relate(graph, low, center, half, 'envelope', [road.id, section.id]);
  relate(graph, center, high, half, 'envelope', [road.id, section.id]);
  ends.forEach((end, ordinal) =>
    containEnd(graph, road, section.id, section.bounds, end, ordinal === 1),
  );
}
function streetEnd(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  road: PrototypeRoad,
  high: boolean,
  input: Input,
): Anchor {
  const a = axes[road.axis],
    b = road.bounds;
  const position = high
    ? b[a.along] + b[a.length] - b[a.breadth] / 2
    : b[a.along] + b[a.breadth] / 2;
  const end = anchor(
    graph,
    `${required(input.keys, road.id)}:${high ? 'end' : 'start'}`,
    a.along,
    position,
  );
  const neighbors = input.neighbors.get(road.id) ?? [];
  neighbors.filter((n) => n.kind === 'street').forEach((n) => joinEnd(graph, lines, end, n));
  return end;
}
function joinEnd(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  end: Anchor,
  neighbor: PrototypeRoad,
): void {
  const line = required(lines, neighbor.id);
  if (line.position === end.position) equate(graph, end, line);
}
function containEnd(
  graph: SupportGraph,
  road: PrototypeRoad,
  owner: string,
  bounds: PrototypeBounds,
  end: Anchor,
  high: boolean,
): void {
  const a = axes[road.axis],
    b = road.bounds;
  const wall = boundsAnchor(graph, owner, bounds, a.along, high);
  const reach = high ? b[a.along] + b[a.length] - end.position : end.position - b[a.along];
  directedRelation(graph, high ? -1 : 1, wall, end, reach, 'envelope', [road.id, owner]);
}

/** Orientation is supplied by retained side/direction, never by the sign of a deficit. */
export function directedRelation(
  graph: SupportGraph,
  direction: number,
  from: Anchor,
  to: Anchor,
  required: number,
  kind: NestedSupportConstraint['kind'],
  provenance: readonly string[],
): void {
  if (direction > 0) relate(graph, from, to, required, kind, provenance);
  else relate(graph, to, from, required, kind, provenance);
}
