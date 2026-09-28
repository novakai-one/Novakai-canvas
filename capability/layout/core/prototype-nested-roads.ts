/** Rectangular corridors connect owner-provided ports; only gate roads cross section boundaries. */
import type {
  PrototypeBounds,
  PrototypePoint,
  PrototypePortLocation,
  PrototypeRoad,
} from '../contract/records/road-prototype.js';
import type { SectionPlacement } from './prototype-nested-placement.js';
import { gridEdges } from './prototype-nested-placement.js';
import { reject } from './nested-support-graph.js';
import { axes } from './prototype-road-geometry.js';
import { readPrototypeNodePorts } from './prototype-road-nodes.js';
export type RoadPitches = Readonly<Record<PrototypeRoad['axis'], number>>;
interface StreetSpan {
  readonly owner: string | null;
  readonly axis: PrototypeRoad['axis'];
  readonly at: number;
  readonly start: number;
  readonly end: number;
  readonly origins: readonly string[];
}
function frame(
  owner: string | null,
  b: PrototypeBounds,
  origin: string,
): StreetSpan[] {
  return [
    ...[b.y, b.y + b.height].map((at, ordinal) => ({
      owner,
      axis: 'horizontal' as const,
      at,
      start: b.x,
      end: b.x + b.width,
      origins: [`${origin}:horizontal:${ordinal}`],
    })),
    ...[b.x, b.x + b.width].map((at, ordinal) => ({
      owner,
      axis: 'vertical' as const,
      at,
      start: b.y,
      end: b.y + b.height,
      origins: [`${origin}:vertical:${ordinal}`],
    })),
  ];
}
function internalStreets(p: SectionPlacement): StreetSpan[] {
  const { size, interior: b } = p;
  const xEdges = gridEdges(size.columnWidths),
    yEdges = gridEdges(size.rowHeights);
  // A moved node can stretch the grid past a pinned frame; streets stop at the frame.
  const ownHeight = Math.min(yEdges.at(-1)!, b.height);
  const ownWidth = Math.min(size.ownWidth, b.width);
  const nodes = p.nodes.map((n) => n.bounds);
  const rows = yEdges
    .slice(1, -1)
    .filter((at) => at < b.height)
    .map((at) =>
      dodge(
        b.y + at,
        b.y,
        b.y + b.height,
        nodes.map((n) => [n.y, n.y + n.height]),
      ),
    );
  const cuts = [b.y, ...rows, b.y + ownHeight];
  return [
    ...frame(size.id, b, `${size.id}:frame`),
    ...rows.flatMap((at, i) =>
      open(size.id, 'horizontal', at, b.x, b.x + ownWidth, nodes, `${size.id}:row:${i}`),
    ),
    ...xEdges
      .slice(1)
      .filter((at) => at <= b.width)
      .flatMap((at, i) =>
        cuts.slice(1).flatMap((stop, band) => {
          const start = cuts[band] as number;
          const inBand = nodes.filter((n) => n.y + n.height > start && n.y < stop);
          const line = dodge(
            b.x + at,
            b.x,
            b.x + b.width,
            inBand.map((n) => [n.x, n.x + n.width]),
          );
          return open(size.id, 'vertical', line, start, stop, inBand, `${size.id}:column:${i}`);
        }),
      ),
  ];
}
/** The parts of a street line not covered by a node body: a street never runs through a node. */
function open(
  owner: string,
  axis: PrototypeRoad['axis'],
  at: number,
  start: number,
  end: number,
  nodes: readonly PrototypeBounds[],
  origin: string,
): StreetSpan[] {
  const v = axis === 'vertical';
  const cover = nodes
    .filter((n) => (v ? at > n.x && at < n.x + n.width : at > n.y && at < n.y + n.height))
    .map((n) => (v ? [n.y - DODGE, n.y + n.height + DODGE] : [n.x - DODGE, n.x + n.width + DODGE]))
    .toSorted((x, y) => (x[0] as number) - (y[0] as number));
  const spans: StreetSpan[] = [];
  let from = start;
  for (const [lo, hi] of cover as [number, number][]) {
    if (lo > from)
      spans.push({ owner, axis, at, start: from, end: Math.min(lo, end), origins: [origin] });
    from = Math.max(from, hi);
  }
  if (from < end) spans.push({ owner, axis, at, start: from, end, origins: [origin] });
  return spans.filter((s) => s.end > s.start);
}
/** Clearance between a moved street and a node body. */
const DODGE = 12;
/** A moved node may sit on a grid street; the street moves to the middle of the nearest clear gap. */
function dodge(
  at: number,
  lo: number,
  hi: number,
  bodies: readonly (readonly [number, number])[],
): number {
  const blocked = bodies
    .map(([a, b]) => [a - DODGE, b + DODGE] as const)
    .toSorted((x, y) => x[0] - y[0]);
  if (!blocked.some(([a, b]) => at > a && at < b)) return at;
  const merged = blocked.reduce<(readonly [number, number])[]>((out, [a, b]) => {
    const last = out.at(-1);
    if (last !== undefined && a <= last[1]) out[out.length - 1] = [last[0], Math.max(last[1], b)];
    else out.push([a, b]);
    return out;
  }, []);
  // Only gaps between bodies; the frame streets already serve the edges.
  const gaps = merged.slice(1).flatMap((m, i) => {
    const from = merged[i]![1],
      to = m[0];
    return from > lo && to < hi && to > from ? [(from + to) / 2] : [];
  });
  return gaps.toSorted((x, y) => Math.abs(x - at) - Math.abs(y - at))[0] ?? at;
}
function mergeSpan(
  spans: readonly StreetSpan[],
  next: StreetSpan,
): readonly StreetSpan[] {
  const last = spans.at(-1);
  if (last === undefined) return [next];
  if (next.start > last.end) return [...spans, next];
  return [
    ...spans.slice(0, -1),
    {
      ...last,
      end: Math.max(last.end, next.end),
      origins: [...last.origins, ...next.origins],
    },
  ];
}
function street(
  s: StreetSpan,
  pitches: RoadPitches,
): PrototypeRoad {
  const half = pitches[s.axis];
  const bounds =
    s.axis === 'horizontal'
      ? { x: s.start - half, y: s.at - half, width: s.end - s.start + 2 * half, height: 2 * half }
      : { x: s.at - half, y: s.start - half, width: 2 * half, height: s.end - s.start + 2 * half };
  return {
    id: `${s.owner ?? 'world'}:${s.axis}:${s.at}:${s.start}`,
    sectionId: s.owner,
    axis: s.axis,
    kind: 'street',
    access: null,
    bounds,
    directions: s.axis === 'horizontal' ? ['left', 'right'] : ['down', 'up'],
  };
}
export function nestedMainRoads(
  placements: readonly SectionPlacement[],
  pitches: RoadPitches,
  retain?: (road: PrototypeRoad, origins: readonly string[]) => void,
): readonly PrototypeRoad[] {
  const spans = [
    ...placements.flatMap((p) =>
      frame(p.section.parentSectionId ?? null, p.surrounding, `${p.section.id}:surrounding`),
    ),
    ...placements.flatMap(internalStreets),
  ];
  const groups = new Map<string, StreetSpan[]>();
  spans.forEach((s) => {
    const key = `${s.owner}:${s.axis}:${s.at}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  });
  return [...groups.values()].flatMap((group) =>
    group
      .toSorted((a, b) => a.start - b.start)
      .reduce<readonly StreetSpan[]>(mergeSpan, [])
      .map((span) => {
        const road = street(span, pitches);
        retain?.(road, span.origins);
        return road;
      }),
  );
}
export function nestedSectionPorts(p: SectionPlacement): readonly PrototypePortLocation[] {
  return readPrototypeNodePorts({
    ...p.section,
    sectionId: p.section.id,
    ports: p.section.ports ?? [],
  });
}
function accessRoad(
  port: PrototypePortLocation,
  start: number,
  end: number,
  pitches: RoadPitches,
): PrototypeRoad {
  const vertical = ['top', 'bottom'].includes(port.side);
  const width = 2 * pitches[vertical ? 'vertical' : 'horizontal'];
  const bounds = vertical
    ? {
        x: port.point.x - width / 2,
        y: start,
        width: width,
        height: end - start,
      }
    : {
        x: start,
        y: port.point.y - width / 2,
        width: end - start,
        height: width,
      };
  return {
    id: `drive:${port.portId}`,
    sectionId: port.sectionId,
    kind: 'driveway',
    bounds,
    ...accessDirection(port),
    access: {
      nodeId: port.nodeId,
      portId: port.portId,
      side: port.side,
      role: port.role,
      ...(port.fixed === undefined ? {} : { fixed: port.fixed }),
      ...(port.advance === undefined ? {} : { advance: port.advance }),
    },
  };
}
/** A moved node connects to the nearest admitted road on its authored side. */
function nodeDrive(
  port: PrototypePortLocation,
  roads: readonly PrototypeRoad[],
  pitches: RoadPitches,
  bodies: readonly PrototypeBounds[] = [],
): PrototypeRoad | null {
  const vertical = ['top', 'bottom'].includes(port.side);
  const a = axes[vertical ? 'vertical' : 'horizontal'];
  const sign = ['top', 'left'].includes(port.side) ? -1 : 1;
  // Ahead of the port first; a moved node sitting on a road may use the road it overlaps.
  const reach = (ahead: boolean) =>
    roads.filter((road) => {
      const b = road.bounds;
      const lead = sign * (b[a.along] + b[a.length] / 2 - port.point[a.along]);
      return (
        road.sectionId === port.sectionId &&
        road.axis !== (vertical ? 'vertical' : 'horizontal') &&
        port.point[a.across] >= b[a.across] &&
        port.point[a.across] <= b[a.across] + b[a.breadth] &&
        (ahead ? lead > b[a.length] / 2 : lead >= -b[a.length] / 2)
      );
    });
  // A driveway through another node is never chosen while a clear road exists.
  const edgeOf = (road: PrototypeRoad) =>
    road.bounds[a.along] + (sign < 0 ? road.bounds[a.length] : 0);
  const free = (road: PrototypeRoad) => {
    const drive = accessRoad(
      port,
      Math.min(port.point[a.along], edgeOf(road)),
      Math.max(port.point[a.along], edgeOf(road)),
      pitches,
    ).bounds;
    return !bodies.some((b) => b !== undefined && interiorOverlap(drive, b, port));
  };
  const ahead = reach(true);
  const clearAhead = ahead.filter(free);
  if (bodies.length > 0 && clearAhead.length === 0 && ahead.length > 0) return null;
  const candidates = ahead.length > 0 ? clearAhead : reach(false);
  const street = candidates.toSorted(
    (left, right) =>
      Math.abs(left.bounds[a.along] + left.bounds[a.length] / 2 - port.point[a.along]) -
      Math.abs(right.bounds[a.along] + right.bounds[a.length] / 2 - port.point[a.along]),
  )[0];
  if (street === undefined) return reject('missing-contact', [port.nodeId, port.portId]);
  const edge = edgeOf(street);
  return accessRoad(
    port,
    Math.min(port.point[a.along], edge),
    Math.max(port.point[a.along], edge),
    pitches,
  );
}
function sectionDrive(
  port: PrototypePortLocation,
  p: SectionPlacement,
  pitches: RoadPitches,
): PrototypeRoad {
  const half = pitches[['top', 'bottom'].includes(port.side) ? 'horizontal' : 'vertical'];
  const a = p.surrounding,
    b = p.interior;
  const intervals = {
    top: [a.y + half, b.y - half],
    left: [a.x + half, b.x - half],
    bottom: [b.y + b.height + half, a.y + a.height - half],
    right: [b.x + b.width + half, a.x + a.width - half],
  };
  const [start = 0, end = 0] = intervals[port.side];
  return accessRoad(port, start, end, pitches);
}
/** Positive-area overlap with a body other than the port's own node. */
function interiorOverlap(
  a: PrototypeBounds,
  b: PrototypeBounds,
  port: PrototypePortLocation,
): boolean {
  const own =
    port.point.x >= b.x &&
    port.point.x <= b.x + b.width &&
    port.point.y >= b.y &&
    port.point.y <= b.y + b.height;
  if (own) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
/** A port whose every road is behind another node is dropped when the node keeps a clear port
 * for the same role; otherwise it keeps the blocked driveway so the wire still lands. */
export function nestedDriveways(
  p: SectionPlacement,
  roads: readonly PrototypeRoad[],
  pitches: RoadPitches,
  bodies: readonly PrototypeBounds[] = [],
): readonly PrototypeRoad[] {
  return [
    ...p.nodes.flatMap((node) => {
      const ports = readPrototypeNodePorts(node);
      const clear = ports.map((port) => nodeDrive(port, roads, pitches, bodies));
      return ports.flatMap((port, i) => {
        const drive = clear[i];
        if (drive !== null && drive !== undefined) return [drive];
        const kept = ports.some((other, j) => other.role === port.role && clear[j] != null);
        if (kept) return [];
        const blocked = nodeDrive(port, roads, pitches);
        return blocked === null ? [] : [blocked];
      });
    }),
    ...nestedSectionPorts(p).map((port) => sectionDrive(port, p, pitches)),
  ];
}

function accessDirection(port: PrototypePortLocation): Pick<PrototypeRoad, 'axis' | 'directions'> {
  const outward = { top: 'up', bottom: 'down', left: 'left', right: 'right' } as const;
  const inward = { top: 'down', bottom: 'up', left: 'right', right: 'left' } as const;
  const direction = port.role === 'exit' ? outward[port.side] : inward[port.side];
  const axis = ['top', 'bottom'].includes(port.side) ? 'vertical' : 'horizontal';
  return { axis, directions: [direction] };
}

/** Interior grid crossings are emitted with the grid, not discovered by pairing roads. */
export function nestedCrossings(placements: readonly SectionPlacement[]) {
  return placements.flatMap((p) => [
    ...gridEdges(p.size.measured.childRowHeights).flatMap((y) =>
      gridEdges(p.size.measured.childColumnWidths).map((x) => ({
        x: p.interior.x + p.size.ownWidth + x,
        y: p.interior.y + y,
      })),
    ),
    ...gridEdges(p.size.rowHeights)
      .slice(1, -1)
      .flatMap((y) =>
        gridEdges(p.size.columnWidths).map((x) => ({ x: p.interior.x + x, y: p.interior.y + y })),
      ),
  ]);
}

/** Every node body across all sections; driveways must not pass through one. */
export function nestedBodies(placements: readonly SectionPlacement[]): readonly PrototypeBounds[] {
  return placements.flatMap((p) => p.nodes.map((node) => node.bounds));
}
/** Where two streets of one section actually meet. A street moved off a node leaves the grid
 * points, so its junctions come from geometry. */
export function streetMeets(main: readonly PrototypeRoad[]): readonly PrototypePoint[] {
  const owner = (r: PrototypeRoad) => r.id.slice(0, r.id.indexOf(':'));
  const mid = (r: PrototypeRoad) =>
    r.axis === 'vertical' ? r.bounds.x + r.bounds.width / 2 : r.bounds.y + r.bounds.height / 2;
  const streets = main.filter((r) => r.kind === 'street');
  const vertical = streets.filter((r) => r.axis === 'vertical');
  return streets
    .filter((r) => r.axis === 'horizontal')
    .flatMap((h) =>
      vertical.flatMap((v) => {
        const x = mid(v),
          y = mid(h);
        const meet =
          owner(v) === owner(h) &&
          x >= h.bounds.x &&
          x <= h.bounds.x + h.bounds.width &&
          y >= v.bounds.y &&
          y <= v.bounds.y + v.bounds.height;
        return meet ? [{ x, y }] : [];
      }),
    );
}
