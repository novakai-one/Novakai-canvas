import type { RoadContact } from './prototype-road-registry.js';
import { roadJunctionIndex, laneAdjacency, junctionAccess } from './prototype-road-adjacency.js';
import { mergePrototypeJunctions } from './prototype-road-junction-union.js';
import type {
  PrototypeRoad,
  PrototypeLane,
  PrototypeJunction,
  PrototypeDivider,
  PrototypeLaneConnection,
} from '../contract/records/road-prototype.js';
import { axes, samePoint } from './prototype-road-geometry.js';
import { connectionPoints, crossingExamples } from './prototype-road-paths.js';

interface Span {
  readonly start: number;
  readonly end: number;
}

/** A construction contact already owns the perpendicular rectangles and their full turn area. */
function junction(
  a: PrototypeRoad,
  b: PrototypeRoad,
): readonly PrototypeJunction[] {
  const horizontal = a.axis === 'horizontal' ? a : b;
  const vertical = a.axis === 'vertical' ? a : b;
  return [
    {
      id: `junction:${a.id}:${b.id}`,
      bounds: {
        x: vertical.bounds.x,
        y: horizontal.bounds.y,
        width: vertical.bounds.width,
        height: horizontal.bounds.height,
      },
      kind: 'bend',
      label: '',
      roadIds: [a.id, b.id],
    },
  ];
}

/** Remove all junction intervals before allocating straight lanes or their dividers. */
function clearSpans(
  road: PrototypeRoad,
  junctions: readonly PrototypeJunction[],
) {
  const axis = axes[road.axis];
  const start = road.bounds[axis.along],
    end = start + road.bounds[axis.length];
  const cuts = junctions
    .map((item) => ({
      junction: item,
      id: item.id,
      start: Math.max(start, item.bounds[axis.along]),
      end: Math.min(end, item.bounds[axis.along] + item.bounds[axis.length]),
    }))
    .toSorted((a, b) => a.start - b.start);
  const areas = cuts.filter((c) => c.end > c.start);
  const starts = [start, ...areas.map((cut) => cut.end)];
  const ends = [...areas.map((cut) => cut.start), end];
  return {
    events: cuts,
    spans: starts
      .map((start, index) => ({ start, end: ends[index] ?? start }))
      .filter((span) => span.end > span.start),
  };
}

function lane(
  road: PrototypeRoad,
  span: Span,
  part: number,
  direction: PrototypeLane['direction'],
  index: number,
): PrototypeLane {
  const axis = axes[road.axis];
  const breadth = road.bounds[axis.breadth] / road.directions.length;
  const bounds = {
    ...road.bounds,
    [axis.along]: span.start,
    [axis.length]: span.end - span.start,
    [axis.across]: road.bounds[axis.across] + index * breadth,
    [axis.breadth]: breadth,
  };
  const across = bounds[axis.across] + breadth / 2;
  const forward = direction === 'right' || direction === 'down';
  const ends = forward ? [span.start, span.end] : [span.end, span.start];
  const point = (along: number) =>
    road.axis === 'horizontal' ? { x: along, y: across } : { x: across, y: along };
  return {
    id: `${road.id}:part-${part}:${direction}`,
    roadId: road.id,
    direction,
    bounds,
    entry: point(ends[0] ?? span.start),
    exit: point(ends[1] ?? span.end),
  };
}

function divider(
  road: PrototypeRoad,
  span: Span,
  index: number,
): PrototypeDivider {
  const axis = axes[road.axis];
  return {
    id: `${road.id}:divider-${index}`,
    roadId: road.id,
    bounds: {
      ...road.bounds,
      [axis.along]: span.start,
      [axis.length]: span.end - span.start,
      [axis.across]: road.bounds[axis.across] + road.bounds[axis.breadth] / 2,
      [axis.breadth]: 0,
    },
  };
}

function dividers(
  road: PrototypeRoad,
  spans: readonly Span[],
): readonly PrototypeDivider[] {
  if (road.directions.length !== 2) return [];
  return spans.map((span, index) => divider(road, span, index));
}

function roadParts(
  road: PrototypeRoad,
  junctions: readonly PrototypeJunction[],
) {
  const { spans, events } = clearSpans(road, junctions);
  const lanes = spans.flatMap((span, part) =>
    road.directions.map((direction, index) => lane(road, span, part, direction, index)),
  );
  return {
    road,
    events,
    lanes,
    dividers: dividers(road, spans),
  };
}

/** Join only lanes touching this junction, instead of searching every junction for every lane pair. */
function junctionConnections(
  junction: PrototypeJunction,
  incoming: readonly PrototypeLane[],
  outgoing: readonly PrototypeLane[],
): readonly PrototypeLaneConnection[] {
  return incoming.flatMap((from) =>
    outgoing
      .filter((to) => to.id !== from.id)
      .map((to) => ({
        id: `${from.id}>${to.id}`,
        fromLaneId: from.id,
        toLaneId: to.id,
        junctionId: junction.id,
        points: connectionPoints(from, to, junction),
      })),
  );
}
function endpointKey(
  lane: PrototypeLane,
  endpoint: 'entry' | 'exit',
): string {
  return `${lane[endpoint].x},${lane[endpoint].y}:${lane.direction}`;
}
/** Index coincident straight endpoints; junction connections retain ownership when both apply. */
function connections(
  lanes: readonly PrototypeLane[],
  junctions: readonly PrototypeJunction[],
  adjacency: ReturnType<typeof laneAdjacency>,
): readonly PrototypeLaneConnection[] {
  const turns = junctions.flatMap((junction) =>
    junctionConnections(
      junction,
      adjacency.incoming.get(junction.id) ?? [],
      adjacency.outgoing.get(junction.id) ?? [],
    ),
  );
  const known = new Set(turns.map((link) => link.id));
  const entries = new Map<string, PrototypeLane[]>();
  lanes.forEach((lane) => {
    const key = endpointKey(lane, 'entry');
    entries.set(key, [...(entries.get(key) ?? []), lane]);
  });
  const straight = lanes.flatMap((from) =>
    (entries.get(endpointKey(from, 'exit')) ?? []).flatMap((to) => straightConnection(from, to)),
  );
  return [...turns, ...straight.filter((link) => !known.has(link.id))];
}

function straightConnection(
  from: PrototypeLane,
  to: PrototypeLane,
): readonly PrototypeLaneConnection[] {
  if (!samePoint(from.exit, to.entry)) return [];
  if (from.direction !== to.direction) return [];
  return [
    {
      id: `${from.id}>${to.id}`,
      fromLaneId: from.id,
      toLaneId: to.id,
      junctionId: null,
      points: connectionPoints(from, to, undefined),
    },
  ];
}

function describedJunction(
  junction: PrototypeJunction,
  index: number,
  adjacent: readonly PrototypeLane[],
  access: PrototypeRoad['access'] | undefined,
  arms: ReadonlySet<string>,
): PrototypeJunction {
  const roadIds = [...new Set(adjacent.map((lane) => lane.roadId))];
  return {
    ...junction,
    label: `J${index + 1}`,
    roadIds,
    kind: access?.role ?? junctionKind(arms.size),
  };
}
function junctionKind(arms: number): 'bend' | 'intersection' {
  return arms > 2 ? 'intersection' : 'bend';
}
const incomingArm = { right: 'left', left: 'right', down: 'top', up: 'bottom' } as const;
const outgoingArm = { right: 'right', left: 'left', down: 'bottom', up: 'top' } as const;
function arms(
  id: string,
  adjacency: ReturnType<typeof laneAdjacency>,
) {
  return new Set([
    ...(adjacency.incoming.get(id) ?? []).map((l) => incomingArm[l.direction]),
    ...(adjacency.outgoing.get(id) ?? []).map((l) => outgoingArm[l.direction]),
  ]);
}

/** Pure, repeatable compilation of this prototype's roads into enforceable lanes and turn areas. */
export function roadNetwork(
  roads: readonly PrototypeRoad[],
  contacts: readonly RoadContact[],
) {
  const areas = roadContactAreas(roads, contacts);
  const ownership = roadJunctionIndex(areas);
  const accessByJunction = junctionAccess(roads, ownership);
  const parts = roads.map((road) => roadParts(road, ownership.get(road.id) ?? []));
  const lanes = parts.flatMap((part) => part.lanes);
  const adjacency = laneAdjacency(roads, registeredEndpoints(parts), lanes);
  const junctions = areas.map((area, index) =>
    describedJunction(
      area,
      index,
      [...(adjacency.incoming.get(area.id) ?? []), ...(adjacency.outgoing.get(area.id) ?? [])],
      accessByJunction.get(area.id)?.access,
      arms(area.id, adjacency),
    ),
  );
  const links = connections(lanes, junctions, adjacency);
  return {
    junctions,
    lanes,
    dividers: parts.flatMap((part) => part.dividers),
    connections: links,
    crossingExamples: crossingExamples(junctions, accessByJunction, lanes, links),
  };
}

function orderedContacts(
  roads: readonly PrototypeRoad[],
  contacts: readonly RoadContact[],
) {
  const order = new Map(roads.map((r, i) => [r.id, i]));
  const normalized = contacts.map((c) =>
    (order.get(c.a.id) ?? 0) < (order.get(c.b.id) ?? 0) ? c : { a: c.b, b: c.a },
  );
  return [...new Map(normalized.map((c) => [`${c.a.id}:${c.b.id}`, c])).values()].toSorted(
    (a, b) =>
      (order.get(a.a.id) ?? 0) - (order.get(b.a.id) ?? 0) ||
      (order.get(a.b.id) ?? 0) - (order.get(b.b.id) ?? 0),
  );
}

/** Ordered per-road junction/mouth events register their lane endpoints without rediscovery. */
function registeredEndpoints(parts: readonly ReturnType<typeof roadParts>[]) {
  return new Map(
    parts.flatMap((p) =>
      p.events.flatMap(
        (e) =>
          [
            [`${p.road.id}:${e.start}`, e.junction.id],
            [`${p.road.id}:${e.end}`, e.junction.id],
          ] as const,
      ),
    ),
  );
}

/** Construction-owned contact regions, shared with support observation; no lane/network compilation. */
export function roadContactAreas(
  roads: readonly PrototypeRoad[],
  contacts: readonly RoadContact[],
) {
  return mergePrototypeJunctions(
    orderedContacts(roads, contacts).flatMap(({ a, b }) => junction(a, b)),
    roads,
  );
}
