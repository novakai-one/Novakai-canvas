import type { PrototypePoint, PrototypePortSide } from '../contract/records/road-prototype.js';
import type { NestedWireSegment } from '../contract/records/nested-wires.js';
import type { Access, Crossing, Terminal, WireRegistry } from './nested-wire-access.js';
import { clear, coverPath } from './nested-wire-corridors.js';
import type { OwnedLine } from './nested-wire-corridors.js';
import { searchTrunk } from './nested-wire-search.js';
type Pair = readonly [PrototypePortSide, PrototypePortSide];
export interface Leg {
  readonly source: Access;
  readonly target: Access;
  readonly segments: readonly NestedWireSegment[];
}
function sameRoad(
  s: Terminal,
  t: Terminal,
  out: PrototypePortSide,
  input: PrototypePortSide,
): boolean {
  const a = s.accesses.find((p) => p.side === out),
    b = t.accesses.find((p) => p.side === input);
  return a !== undefined && a.roadId === b?.roadId;
}
/** Band law, then shared-road law, then the quadrant corner. Search runs only when this fails. */
function pair(
  s: Terminal,
  t: Terminal,
): Pair {
  const bands: readonly { readonly matches: boolean; readonly value: Pair }[] = [
    { matches: s.point.y === t.point.y, value: ['right', 'left'] },
    { matches: s.point.x === t.point.x, value: ['bottom', 'top'] },
    { matches: sameRoad(s, t, 'right', 'left'), value: ['right', 'left'] },
    { matches: sameRoad(s, t, 'bottom', 'top'), value: ['bottom', 'top'] },
  ];
  return bands.find((rule) => rule.matches)?.value ?? quadrant(s, t);
}
function quadrant(
  s: Terminal,
  t: Terminal,
): Pair {
  return s.point.x < t.point.x ? ['right', 'top'] : ['bottom', 'left'];
}

function shifted(
  a: Access,
  offset: number,
): PrototypePoint {
  return a.drive.axis === 'horizontal'
    ? { x: a.join.x + offset, y: a.join.y }
    : { x: a.join.x, y: a.join.y + offset };
}
function line(
  from: PrototypePoint,
  to: PrototypePoint,
  roadId: string,
): OwnedLine {
  return { from, to, roadId };
}
function highway(
  a: Access,
  b: Access,
  registry: WireRegistry,
): Crossing | undefined {
  const destination = new Set((registry.crossings.get(b.roadId) ?? []).map((c) => c.roadId));
  const coordinate = a.drive.axis === 'horizontal' ? 'y' : 'x';
  const candidates = (registry.crossings.get(a.roadId) ?? []).filter((c) =>
    destination.has(c.roadId),
  );
  // Every candidate is an actual shared crossing. Minimum Manhattan detour preserves the pair law.
  return candidates
    .map((c) => ({
      crossing: c,
      length: Math.abs(c.at - a.join[coordinate]) + Math.abs(c.at - b.join[coordinate]),
    }))
    .toSorted((x, y) => x.length - y.length)[0]?.crossing;
}
function trunk(
  a: Access,
  b: Access,
  registry: WireRegistry,
  offset: number,
): readonly OwnedLine[] | null {
  const p = shifted(a, offset),
    q = shifted(b, offset);
  if (a.roadId === b.roadId)
    return [line(a.mouth, p, a.roadId), line(p, q, a.roadId), line(q, b.mouth, b.roadId)];
  return turns(a, b, p, q, registry, offset) ?? searchTrunk(a, b, p, q, registry, offset);
}
function turns(
  a: Access,
  b: Access,
  p: PrototypePoint,
  q: PrototypePoint,
  registry: WireRegistry,
  offset: number,
): readonly OwnedLine[] | null {
  if (a.drive.axis !== b.drive.axis) return corner(a, b, p, q, registry);
  const crossing = highway(a, b, registry);
  if (crossing === undefined) return null;
  return crossingLines(a, b, p, q, crossing, offset);
}
function crossingLines(
  a: Access,
  b: Access,
  p: PrototypePoint,
  q: PrototypePoint,
  crossing: Crossing,
  offset: number,
): readonly OwnedLine[] {
  const at = crossing.at + offset;
  const first = a.drive.axis === 'horizontal' ? { x: p.x, y: at } : { x: at, y: p.y };
  const last = a.drive.axis === 'horizontal' ? { x: q.x, y: at } : { x: at, y: q.y };
  return [
    line(a.mouth, p, a.roadId),
    line(p, first, a.roadId),
    line(first, last, crossing.roadId),
    line(last, q, b.roadId),
    line(q, b.mouth, b.roadId),
  ];
}
function corner(
  a: Access,
  b: Access,
  p: PrototypePoint,
  q: PrototypePoint,
  registry: WireRegistry,
): readonly OwnedLine[] | null {
  if (!(registry.crossings.get(a.roadId) ?? []).some((c) => c.roadId === b.roadId)) return null;
  const point = a.drive.axis === 'horizontal' ? { x: p.x, y: q.y } : { x: q.x, y: p.y };
  return [
    line(a.mouth, p, a.roadId),
    line(p, point, a.roadId),
    line(point, q, b.roadId),
    line(q, b.mouth, b.roadId),
  ];
}
export interface LegPreference {
  readonly source: Access | undefined;
  readonly target: Access | undefined;
  readonly original: boolean;
}
/** Rank admitted legacy pairs before extended pairs; no route is evaluated to choose a pair. */
export function lawPreference(
  s: Terminal,
  t: Terminal,
): LegPreference {
  const [out, input] = pair(s, t);
  const source = s.accesses.find((p) => p.side === out),
    target = t.accesses.find((p) => p.side === input);
  return {
    source: source ?? s.accesses[0],
    target: target ?? t.accesses[0],
    original: source !== undefined && target !== undefined,
  };
}
/** Keep an admitted legacy pair, otherwise use the fixed terminal's admitted direction.
 * Mirrored corners depend on driveway axis, so left/top approaches obey the same rule.
 * If the law's pair cannot connect, the shortest other side pair is used instead.
 */
export function lawLeg(
  s: Terminal,
  t: Terminal,
  registry: WireRegistry,
  offset: number,
  preference = lawPreference(s, t),
): Leg | null {
  const { source, target } = preference;
  const preferred =
    source === undefined || target === undefined
      ? null
      : completeLeg(source, target, registry, offset);
  return preferred ?? fallbackLeg(s, t, registry, offset);
}
function fallbackLeg(
  s: Terminal,
  t: Terminal,
  registry: WireRegistry,
  offset: number,
): Leg | null {
  const legs = s.accesses.flatMap((a) =>
    t.accesses.flatMap((b) => {
      const leg = completeLeg(a, b, registry, offset);
      return leg === null ? [] : [leg];
    }),
  );
  return legs.toSorted((x, y) => length(x) - length(y))[0] ?? null;
}
function length(leg: Leg): number {
  return leg.segments.reduce(
    (sum, s) => sum + Math.abs(s.to.x - s.from.x) + Math.abs(s.to.y - s.from.y),
    0,
  );
}
function completeLeg(
  source: Access,
  target: Access,
  registry: WireRegistry,
  offset: number,
): Leg | null {
  const law = trunk(source, target, registry, offset);
  const middle =
    law !== null && law.every((l) => clear(l, registry.bodies))
      ? law
      : searchTrunk(
          source,
          target,
          shifted(source, offset),
          shifted(target, offset),
          registry,
          offset,
        );
  if (middle === null) return null;
  const segments = coverPath(
    [
      line(source.port, source.mouth, source.drive.id),
      ...middle,
      line(target.mouth, target.port, target.drive.id),
    ],
    registry.roads,
  );
  if (segments === null) return null;
  return { source, target, segments };
}
