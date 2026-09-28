import type { PrototypePoint, PrototypeRoad } from '../contract/records/road-prototype.js';
import { axes } from './prototype-road-geometry.js';

export interface RoadEntry {
  readonly road: PrototypeRoad;
  readonly at: number;
  readonly low: number;
  readonly high: number;
}
export interface RoadRegistry {
  readonly entries: ReadonlyMap<string, RoadEntry>;
  readonly lines: ReadonlyMap<string, readonly RoadEntry[]>;
}
function entry(road: PrototypeRoad): RoadEntry {
  const a = axes[road.axis],
    b = road.bounds;
  return {
    road,
    at: b[a.across] + b[a.breadth] / 2,
    low: b[a.along],
    high: b[a.along] + b[a.length],
  };
}
/** Construction-only index. Entries retain their road identity; queries never enumerate the scene. */
export function roadRegistry(roads: readonly PrototypeRoad[]): RoadRegistry {
  const entries = new Map(roads.map((r) => [r.id, entry(r)]));
  const lines = new Map<string, RoadEntry[]>();
  entries.forEach((e) => {
    const key = `${e.road.axis}:${e.at.toFixed(6)}`;
    lines.set(key, [...(lines.get(key) ?? []), e]);
  });
  return { entries, lines };
}
export function streetAt(
  registry: RoadRegistry,
  axis: PrototypeRoad['axis'],
  point: PrototypePoint,
): readonly RoadEntry[] {
  const a = axes[axis];
  return (registry.lines.get(`${axis}:${point[a.across].toFixed(6)}`) ?? []).filter(
    (e) => e.road.kind === 'street' && point[a.along] >= e.low && point[a.along] <= e.high,
  );
}
/** Frame endpoints are construction events, including T joins between neighboring frames. */
export function frameEnds(roads: readonly PrototypeRoad[]): readonly PrototypePoint[] {
  return roads.flatMap((r) => {
    const a = axes[r.axis],
      b = r.bounds,
      half = b[a.breadth] / 2;
    const at = b[a.across] + half;
    return [b[a.along] + half, b[a.along] + b[a.length] - half].map((value) =>
      r.axis === 'horizontal' ? { x: value, y: at } : { x: at, y: value },
    );
  });
}
export interface RoadContact {
  readonly a: PrototypeRoad;
  readonly b: PrototypeRoad;
}
function crossing(
  registry: RoadRegistry,
  p: PrototypePoint,
): readonly RoadContact[] {
  return streetAt(registry, 'horizontal', p).flatMap((h) =>
    streetAt(registry, 'vertical', p).map((v) => ({ a: h.road, b: v.road })),
  );
}
function mouths(
  registry: RoadRegistry,
  drive: PrototypeRoad,
  halfWidths: number | Readonly<Record<PrototypeRoad['axis'], number>>,
): readonly RoadContact[] {
  const e = registry.entries.get(drive.id);
  if (e === undefined) return [];
  const perpendicular = drive.axis === 'horizontal' ? 'vertical' : 'horizontal';
  const halfWidth = typeof halfWidths === 'number' ? halfWidths : halfWidths[perpendicular];
  const points = [e.low - halfWidth, e.high + halfWidth].map((value) =>
    drive.axis === 'horizontal' ? { x: value, y: e.at } : { x: e.at, y: value },
  );
  return points.flatMap((p) =>
    streetAt(registry, perpendicular, p).map((s) => ({ a: s.road, b: drive })),
  );
}
/** The builder supplies actual crossing events and driveway ends, never road-pair candidates. */
export function constructedContacts(
  registry: RoadRegistry,
  points: readonly PrototypePoint[],
  drives: readonly PrototypeRoad[],
  halfWidths: number | Readonly<Record<PrototypeRoad['axis'], number>>,
): readonly RoadContact[] {
  const unique = new Map(points.map((p) => [`${p.x},${p.y}`, p]));
  const contacts = [...unique.values()].flatMap((p) => crossing(registry, p));
  return [...contacts, ...drives.flatMap((d) => mouths(registry, d, halfWidths))];
}
