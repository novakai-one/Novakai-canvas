import type { PrototypeRoad } from '../contract/records/road-prototype.js';
import type {
  NestedSupportLedger,
  NestedSupportSpanGrowth,
} from '../contract/records/nested-support.js';
import { readNestedProjectionSupports } from './nested-lane-projection.js';
import { axes } from './prototype-road-geometry.js';
import { reject, required } from './nested-support-graph.js';

type Supports = ReturnType<typeof readNestedProjectionSupports>;
type Join = Supports[number]['joins'][number];

/** Complete selected bridge rows, then propagate their extents over retained cap contacts.
 * This is a single algebraic reservation pass, never collision-driven iteration.
 * Builder/embedding Result boundaries own typed rejection; recovery is caller reconstruction.
 */
export function bridgeSpanGrowth(
  supports: Supports,
  roads: ReadonlyMap<string, PrototypeRoad>,
  contacts: readonly { readonly a: PrototypeRoad; readonly b: PrototypeRoad }[],
): readonly NestedSupportSpanGrowth[] {
  const growth = new Map<string, NestedSupportSpanGrowth>();
  supports.forEach((support) =>
    support.joins.forEach((join) => bridgeGrowth(growth, join, support.wire.id, roads)),
  );
  const bridges = new Map(growth);
  contacts.forEach(({ a, b }) => {
    capGrowth(growth, a, b, bridges);
    capGrowth(growth, b, a, bridges);
  });
  return [...growth.values()];
}
function bridgeGrowth(
  growth: Map<string, NestedSupportSpanGrowth>,
  join: Join,
  wireId: string,
  roads: ReadonlyMap<string, PrototypeRoad>,
): void {
  if (join.incoming.road.axis !== join.outgoing.road.axis) return;
  const road = required(roads, join.nominal.roadId);
  if (road.axis === join.incoming.road.axis) return;
  const axis = axes[road.axis].across,
    dimension = axes[road.axis].breadth;
  const points = [join.nominal.from, ...(join.nominal.via ?? []), join.nominal.to];
  const low = Math.min(road.bounds[axis], ...points.map((p) => p[axis]));
  const high = Math.max(road.bounds[axis] + road.bounds[dimension], ...points.map((p) => p[axis]));
  record(growth, {
    roadId: road.id,
    axis,
    negative: road.bounds[axis] - low,
    positive: high - road.bounds[axis] - road.bounds[dimension],
    provenance: [wireId, String(join.incoming.first), road.id, 'complete-bridge-footprint'],
  });
}
function record(
  growth: Map<string, NestedSupportSpanGrowth>,
  span: NestedSupportSpanGrowth,
): void {
  if (span.negative === 0 && span.positive === 0) return;
  const key = JSON.stringify([span.roadId, span.axis]),
    prior = growth.get(key);
  growth.set(key, {
    ...span,
    negative: Math.max(prior?.negative ?? 0, span.negative),
    positive: Math.max(prior?.positive ?? 0, span.positive),
    provenance: [...new Set([...(prior?.provenance ?? []), ...span.provenance])],
  });
}
function capGrowth(
  growth: Map<string, NestedSupportSpanGrowth>,
  road: PrototypeRoad,
  neighbor: PrototypeRoad,
  bridges: ReadonlyMap<string, NestedSupportSpanGrowth>,
): void {
  if ([road.kind !== 'street', road.axis === neighbor.axis].some(Boolean)) return;
  const a = axes[road.axis],
    span = bridges.get(JSON.stringify([neighbor.id, a.along]));
  if (span === undefined) return;
  record(growth, {
    roadId: road.id,
    axis: a.along,
    negative: matchingReach(road.bounds[a.along], neighbor.bounds[a.along], span.negative),
    positive: matchingReach(
      road.bounds[a.along] + road.bounds[a.length],
      neighbor.bounds[a.along] + neighbor.bounds[a.length],
      span.positive,
    ),
    provenance: [...span.provenance, road.id, 'construction-cap'],
  });
}

function matchingReach(
  edge: number,
  contact: number,
  reach: number,
): number {
  return edge === contact ? reach : 0;
}

/** Raise the existing envelope/mouth inequalities and floor every anchor at the first solve.
 * The caller may solve this ledger exactly once; further gaps are explicit infeasibility.
 * Builder/embedding Result boundaries own typed rejection; recovery is caller reconstruction.
 */
export function expandedSupportLedger(
  ledger: NestedSupportLedger,
  values: ReadonlyMap<string, number>,
  growth: readonly NestedSupportSpanGrowth[],
): NestedSupportLedger {
  const vertices = ledger.vertices.map((v) => ({ ...v, position: required(values, v.key) }));
  const spans = new Map(growth.map((g) => [JSON.stringify([g.roadId, g.axis]), g]));
  const byKey = new Map(vertices.map((v) => [v.key, v]));
  const constraints = ledger.constraints.map((edge) => {
    const from = required(byKey, edge.from),
      to = required(byKey, edge.to);
    const producers = edge.provenance.flatMap((id) => {
      const span = spans.get(JSON.stringify([id, from.axis]));
      return span === undefined ? [] : [span];
    });
    const additions = producers.map((span) => reachIncrease(ledger, edge, from.aliases, span));
    const increase = Math.max(0, ...additions),
      need = edge.required + increase,
      available = to.position - from.position;
    return {
      ...edge,
      required: need,
      available,
      deficit: Math.max(0, need - available),
      provenance:
        increase === 0
          ? edge.provenance
          : [...edge.provenance, ...producers.flatMap((p) => p.provenance)],
    };
  });
  return { ...ledger, vertices, constraints, spanGrowth: growth };
}
function reachIncrease(
  ledger: NestedSupportLedger,
  edge: NestedSupportLedger['constraints'][number],
  from: readonly string[],
  span: NestedSupportSpanGrowth,
): number {
  if (!['envelope', 'body-fan', 'gate-normal', 'structure'].includes(edge.kind)) return 0;
  const population = ledger.populations.find((p) => p.roadId === span.roadId);
  if (population === undefined) return reject('missing-contact', [span.roadId]);
  return sideIncrease(from, population.key, span);
}
function sideIncrease(
  from: readonly string[],
  key: string,
  span: NestedSupportSpanGrowth,
): number {
  const positive = [key, `${key}:end`].some((alias) => from.includes(alias));
  return positive ? span.positive : span.negative;
}
