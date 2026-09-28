import type { VisualSection } from '../../contract/records/input.js';
import type { SectionCandidate } from '../../contract/records/candidate.js';
import type { RoutingOverlay } from '../../contract/records/routing-overlay.js';
import { contains } from '../geometry/intersections.js';
import { same, sameIds } from './facts.js';
import { reject } from './outcomes.js';

/** Display geometry follows the same structural admission boundary as candidate wire geometry. */
export function inspectRouting(
  source: VisualSection,
  candidate: SectionCandidate,
): RoutingOverlay | undefined {
  const routing = candidate.routing;
  if (routing === undefined) return undefined;
  same(source.mode, 'modules', `${source.id}.routing`);
  unique(routing.roads, source.id);
  unique(routing.lanes, source.id);
  const frame = {
    ...candidate.box,
    x: candidate.box.x - candidate.origin.x,
    y: candidate.box.y - candidate.origin.y,
  };
  const roads = new Map(routing.roads.map((road) => [road.id, road]));
  routing.roads.forEach((road) => inside(frame, centerline(road), road.id));
  routing.lanes.forEach((lane) => inspectLane(lane, roads));
  return routing;
}
function unique(
  items: readonly { readonly id: string }[],
  path: string,
): void {
  const ids = items.map((item) => item.id);
  sameIds([...new Set(ids)], ids, `${path}.routing`);
}
function inside(
  outer: RoutingOverlay['roads'][number]['bounds'],
  inner: typeof outer,
  id: string,
): void {
  if (!contains(outer, inner))
    reject('invalid-input', id, 'Routing display geometry exceeds its enclosing bounds');
}
function inspectLane(
  lane: RoutingOverlay['lanes'][number],
  roads: ReadonlyMap<string, RoutingOverlay['roads'][number]>,
): void {
  const road = roads.get(lane.roadId);
  if (road === undefined) return reject('invalid-input', lane.id, 'Lane references a missing road');
  inside(road.bounds, lane.bounds, lane.id);
  const horizontal = ['left', 'right'].includes(lane.direction);
  same(horizontal, road.axis === 'horizontal', lane.id);
}

/** Street rectangles include half-thickness end caps as well as boundary straddling. */
function centerline(
  road: RoutingOverlay['roads'][number],
): RoutingOverlay['roads'][number]['bounds'] {
  if (road.kind === 'driveway') return road.bounds;
  return streetLine(road);
}
function streetLine(
  road: RoutingOverlay['roads'][number],
): RoutingOverlay['roads'][number]['bounds'] {
  const box = road.bounds;
  const horizontal = road.axis === 'horizontal';
  const half = (horizontal ? box.height : box.width) / 2;
  return horizontal
    ? { x: box.x + half, y: box.y + half, width: box.width - 2 * half, height: 0 }
    : { x: box.x + half, y: box.y + half, width: 0, height: box.height - 2 * half };
}
