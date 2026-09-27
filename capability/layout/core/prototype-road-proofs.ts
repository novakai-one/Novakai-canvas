import type { PrototypeRoadProof, PrototypeProofPath } from '../contract/records/road-proof.js';
import type {
  PrototypeLaneConnection,
  PrototypeLane,
  PrototypePoint,
  PrototypeJunction,
  PrototypeRoad,
} from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import { directionVector } from './prototype-road-geometry.js';

type Context = ReturnType<typeof context>;
function context(scene: RoadPrototypeScene) {
  return {
    scene,
    lanes: new Map(scene.lanes.map((l) => [l.id, l])),
    roads: new Map(scene.roads.map((r) => [r.id, r])),
  };
}
function isGate(
  ctx: Context,
  lane: PrototypeLane | undefined,
): boolean {
  return ctx.roads.get(lane?.roadId ?? '')?.access?.nodeId.startsWith('section-') ?? false;
}
function continuation(
  ctx: Context,
  link: PrototypeLaneConnection,
  which: 'fromLaneId' | 'toLaneId',
) {
  const lane = ctx.lanes.get(link[which]);
  if (!isGate(ctx, lane)) return undefined;
  const opposite = which === 'fromLaneId' ? 'toLaneId' : 'fromLaneId';
  return ctx.scene.connections.find((c) => c[opposite] === lane?.id);
}
function safePoint(lane: PrototypeLane): PrototypePoint {
  // Midpoint of a legal straight lane: visibly clear of either adjacent junction.
  return { x: (lane.entry.x + lane.exit.x) / 2, y: (lane.entry.y + lane.exit.y) / 2 };
}
function start(
  ctx: Context,
  lane: PrototypeLane,
): PrototypePoint {
  if (ctx.roads.get(lane.roadId)?.access !== null) return lane.entry;
  return safePoint(lane);
}
function finish(
  ctx: Context,
  lane: PrototypeLane,
): PrototypePoint {
  if (ctx.roads.get(lane.roadId)?.access !== null) return lane.exit;
  return safePoint(lane);
}
function expanded(
  ctx: Context,
  link: PrototypeLaneConnection,
): PrototypeProofPath {
  const links = [
    continuation(ctx, link, 'fromLaneId'),
    link,
    continuation(ctx, link, 'toLaneId'),
  ].filter((x): x is PrototypeLaneConnection => x !== undefined);
  const first = ctx.lanes.get(links[0]?.fromLaneId ?? ''),
    last = ctx.lanes.get(links.at(-1)?.toLaneId ?? '');
  const points = [
    ...(first ? [start(ctx, first)] : []),
    ...links.flatMap((l) => l.points),
    ...(last ? [finish(ctx, last)] : []),
  ];
  return {
    points,
    connectionIds: links.map((l) => l.id),
    laneIds: [links[0]?.fromLaneId ?? '', ...links.map((l) => l.toLaneId)],
  };
}
function segments(points: readonly PrototypePoint[]) {
  return points
    .slice(1)
    .map((b, i) => ({ a: points[i] ?? b, b }))
    .filter((s) => s.a.x !== s.b.x || s.a.y !== s.b.y);
}
function range(
  a: number,
  b: number,
  c: number,
  d: number,
): number {
  return Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
}
function parallelOverlap(
  a: ReturnType<typeof segments>[number],
  b: ReturnType<typeof segments>[number],
): boolean {
  if ([a.a.y === a.b.y, b.a.y === b.b.y].every(Boolean))
    return a.a.y === b.a.y && range(a.a.x, a.b.x, b.a.x, b.b.x) > 0;
  return [
    a.a.x === a.b.x,
    b.a.x === b.b.x,
    a.a.x === b.a.x,
    range(a.a.y, a.b.y, b.a.y, b.b.y) > 0,
  ].every(Boolean);
}
function overlaps(
  a: PrototypeProofPath,
  b: PrototypeProofPath,
): boolean {
  return segments(a.points).some((x) => segments(b.points).some((y) => parallelOverlap(x, y)));
}
function cross(
  a: ReturnType<typeof segments>[number],
  b: ReturnType<typeof segments>[number],
): readonly PrototypePoint[] {
  const h = [a, b].find((s) => s.a.y === s.b.y),
    v = [a, b].find((s) => s.a.x === s.b.x);
  if (h === undefined || v === undefined) return [];
  const p = { x: v.a.x, y: h.a.y };
  const interior = [
    p.x > Math.min(h.a.x, h.b.x),
    p.x < Math.max(h.a.x, h.b.x),
    p.y > Math.min(v.a.y, v.b.y),
    p.y < Math.max(v.a.y, v.b.y),
  ];
  return interior.every(Boolean) ? [p] : [];
}
function crossings(
  a: PrototypeProofPath,
  b: PrototypeProofPath,
) {
  return segments(a.points).flatMap((x) => segments(b.points).flatMap((y) => cross(x, y)));
}
function turning(
  ctx: Context,
  c: PrototypeLaneConnection,
): boolean {
  const a = directionVector[ctx.lanes.get(c.fromLaneId)?.direction ?? 'left'];
  const b = directionVector[ctx.lanes.get(c.toLaneId)?.direction ?? 'left'];
  return a.x * b.x + a.y * b.y === 0;
}
function candidates(
  ctx: Context,
  links: readonly PrototypeLaneConnection[],
  road: PrototypeRoad | undefined,
) {
  if (road === undefined) return links.filter((c) => turning(ctx, c));
  return links.filter((c) =>
    [c.fromLaneId, c.toLaneId].some((id) => ctx.lanes.get(id)?.roadId === road.id),
  );
}
function pair(
  ctx: Context,
  a: PrototypeLaneConnection,
  b: PrototypeLaneConnection,
) {
  const primary = expanded(ctx, a),
    through = expanded(ctx, b);
  if (overlaps(primary, through)) return [];
  return [{ primary, through, crossings: crossings(primary, through) }];
}
function proof(
  ctx: Context,
  junction: PrototypeJunction,
  road: PrototypeRoad | undefined,
): PrototypeRoadProof[] {
  const links = ctx.scene.connections.filter((c) => c.junctionId === junction.id);
  const options = candidates(ctx, links, road).flatMap((a) =>
    traffic(ctx, links).flatMap((b) => pair(ctx, a, b)),
  );
  const selected = options.find((p) => p.crossings.length > 0) ?? options[0];
  if (selected === undefined) return [];
  const name = road?.access
    ? `${road.access.nodeId} ${road.access.side} ${road.access.role}`
    : junction.kind;
  return [
    {
      id: `${junction.label}:${road?.id ?? 'turn'}`,
      title: `${junction.label} · ${name}`,
      junctionId: junction.id,
      portId: road?.access?.portId ?? null,
      ...selected,
    },
  ];
}
function forJunction(
  ctx: Context,
  j: PrototypeJunction,
) {
  const access = ctx.scene.roads.filter((r) => r.access !== null && j.roadIds.includes(r.id));
  if (access.length === 0) return proof(ctx, j, undefined);
  return access.flatMap((r) => proof(ctx, j, r));
}
/** Exhaustive visual cases, generated once for inspection, never part of a wire route query. */
export function createRoadProofs(scene: RoadPrototypeScene): readonly PrototypeRoadProof[] {
  const ctx = context(scene);
  return scene.junctions.flatMap((j) => forJunction(ctx, j));
}

function traffic(
  ctx: Context,
  links: readonly PrototypeLaneConnection[],
) {
  return links
    .filter((c) =>
      [c.fromLaneId, c.toLaneId].every(
        (id) => ctx.roads.get(ctx.lanes.get(id)?.roadId ?? '')?.access === null,
      ),
    )
    .toSorted((a, b) => Number(turning(ctx, a)) - Number(turning(ctx, b)));
}
