import type {
  NestedSupportGate,
  NestedSupportFootprint,
} from '../contract/records/nested-support.js';
import type { PrototypePortLocation, PrototypeRoad } from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import { terminalDepth } from './nested-terminal-pins.js';
import { axes } from './prototype-road-geometry.js';
import { nestedLanePitch } from './prototype-nested-placement.js';
import type { retainSupportInput } from './nested-support-input.js';
import { anchor, equate, equateOffset, reject, required } from './nested-support-graph.js';
import type { Anchor, SupportGraph } from './nested-support-graph.js';
import { directedRelation } from './nested-support-structure.js';

type Input = ReturnType<typeof retainSupportInput>;
const dimensions = { x: 'width', y: 'height' } as const;
interface MouthContext {
  readonly graph: SupportGraph;
  readonly lines: ReadonlyMap<string, Anchor>;
  readonly input: Input;
  readonly scene: RoadPrototypeScene;
  readonly footprints: ReadonlyMap<string, readonly NestedSupportFootprint[]>;
}

/** Terminal capacity and gate tangential admission are distinct from normal approach deficits. */
export function supportMouths(
  request: Omit<MouthContext, 'footprints'> & {
    readonly footprints: readonly NestedSupportFootprint[];
  },
): readonly NestedSupportGate[] {
  const context: MouthContext = { ...request, footprints: footprintIndex(request.footprints) };
  const gates = new Set(
    context.scene.ports.filter((port) => port.nodeId === port.sectionId).map((port) => port.portId),
  );
  const results: NestedSupportGate[] = [];
  context.scene.ports.forEach((port) => {
    const drive = context.input.final.get(`drive:${port.portId}`);
    if (drive !== undefined) mouth(context, port, drive, gates, results);
  });
  sideOrder(context, results);
  return results;
}
function mouth(
  context: MouthContext,
  port: PrototypePortLocation,
  drive: PrototypeRoad,
  gates: ReadonlySet<string>,
  results: NestedSupportGate[],
): void {
  const streets = (context.input.neighbors.get(drive.id) ?? []).map((r) =>
    required(context.input.final, r.id),
  );
  if (port.nodeId !== port.sectionId) return terminalMouth(context, port, drive, streets);
  if (gates.has(port.portId)) results.push(gateMouth(context, port, drive, streets));
}
function terminalMouth(
  context: MouthContext,
  port: PrototypePortLocation,
  drive: PrototypeRoad,
  streets: readonly PrototypeRoad[],
): void {
  const { graph, lines, input } = context;
  const node = input.nodes.get(port.nodeId);
  if (node === undefined) return reject('missing-contact', [port.nodeId]);
  const a = axes[drive.axis],
    count = drive.wireLaneCount ?? 0;
  admitPins(port, count, node.bounds[a.breadth]);
  const center = required(graph.anchors, `${node.id}:${a.along}:center`);
  equateOffset(
    graph,
    required(lines, drive.id),
    required(graph.anchors, `${node.id}:${a.across}:center`),
  );
  const depth = terminalDepth(port, count);
  streets.forEach((street) => {
    const half = street.bounds[a.length] / 2;
    directedRelation(
      graph,
      outward(port),
      center,
      required(lines, street.id),
      node.bounds[a.length] / 2 + half + depth,
      'body-fan',
      [node.id, port.portId, street.id],
    );
  });
}
function admitPins(
  port: PrototypePortLocation,
  count: number,
  available: number,
): void {
  if (count === 0 || port.fixed) return;
  const need = nestedLanePitch * 2 + Math.max(0, count - 1) * nestedLanePitch;
  if (need > available)
    reject('insufficient-terminal-pins', [port.nodeId, port.portId], [need], [available]);
}
function outward(port: PrototypePortLocation): number {
  return ['top', 'left'].includes(port.side) ? -1 : 1;
}
function gateMouth(
  context: MouthContext,
  port: PrototypePortLocation,
  drive: PrototypeRoad,
  streets: readonly PrototypeRoad[],
): NestedSupportGate {
  if (streets.length !== 2) return reject('missing-contact', [port.portId], [2], [streets.length]);
  const section = context.input.sections.get(port.sectionId);
  if (section === undefined) return reject('missing-contact', [port.sectionId]);
  return gateBounds(context, port, drive, streets, section.bounds);
}
function gateBounds(
  context: MouthContext,
  port: PrototypePortLocation,
  drive: PrototypeRoad,
  streets: readonly PrototypeRoad[],
  b: PrototypeRoad['bounds'],
): NestedSupportGate {
  const { graph, lines } = context,
    a = axes[drive.axis];
  const [negative, positive] = tangentialReach(context, port, drive);
  const lo = Math.max(b[a.across], ...streets.map((r) => r.bounds[a.across])) + negative;
  const hi =
    Math.min(
      b[a.across] + b[a.breadth],
      ...streets.map((r) => r.bounds[a.across] + r.bounds[a.breadth]),
    ) - positive;
  if (lo > hi)
    return reject(
      'empty-interval',
      [port.portId, ...streets.map((r) => r.id)],
      [lo, hi],
      [b[a.across], b[a.across] + b[a.breadth]],
    );
  const gate = anchor(graph, `${port.portId}:center`, a.across, port.point[a.across]);
  equate(graph, gate, required(lines, drive.id));
  const low = required(graph.anchors, `${port.sectionId}:${a.across}:low`),
    high = required(graph.anchors, `${port.sectionId}:${a.across}:high`);
  directedRelation(graph, 1, low, gate, negative, 'gate-tangent', [port.portId]);
  directedRelation(graph, 1, gate, high, positive, 'gate-tangent', [port.portId]);
  streets.forEach((street) => contactInterval(context, port, gate, street, negative, positive));
  const normalConstraints = streets.map((street) => gateNormal(context, port, a.along, street));
  return {
    portId: port.portId,
    preferred: port.point[a.across],
    interval: [lo, hi],
    normalConstraints,
  };
}
function tangentialReach(
  context: MouthContext,
  port: PrototypePortLocation,
  drive: PrototypeRoad,
): readonly [number, number] {
  const a = axes[drive.axis],
    half = drive.bounds[a.breadth] / 2,
    key = required(context.input.keys, drive.id);
  const offsets = (context.footprints.get(key) ?? []).flatMap((f) =>
    f.points.map((p) => p[a.across] - port.point[a.across]),
  );
  return [Math.max(half, ...offsets.map((n) => -n)), Math.max(half, ...offsets)];
}
function contactInterval(
  context: MouthContext,
  port: PrototypePortLocation,
  gate: Anchor,
  street: PrototypeRoad,
  negative: number,
  positive: number,
): void {
  const { graph, input } = context,
    key = required(input.keys, street.id),
    axis = gate.axis;
  const start = required(graph.anchors, `${key}:start`),
    end = required(graph.anchors, `${key}:end`);
  directedRelation(
    graph,
    1,
    start,
    gate,
    negative + street.bounds[axis] - start.position,
    'gate-tangent',
    [port.portId, street.id],
  );
  directedRelation(
    graph,
    1,
    gate,
    end,
    positive + end.position - street.bounds[axis] - street.bounds[dimensions[axis]],
    'gate-tangent',
    [port.portId, street.id],
  );
}
function gateNormal(
  context: MouthContext,
  port: PrototypePortLocation,
  axis: Anchor['axis'],
  street: PrototypeRoad,
): string {
  const { graph, lines } = context;
  const sign = street.sectionId === port.sectionId ? -outward(port) : outward(port);
  const wall = required(
    graph.anchors,
    `${port.sectionId}:${axis}:${outward(port) > 0 ? 'high' : 'low'}`,
  );
  const id = `constraint:${graph.relations.length}`;
  directedRelation(
    graph,
    sign,
    wall,
    required(lines, street.id),
    street.bounds[dimensions[axis]] / 2 + nestedLanePitch / 4,
    'gate-normal',
    [port.portId, street.id],
  );
  return id;
}
function sideOrder(
  context: MouthContext,
  gates: readonly NestedSupportGate[],
): void {
  const groups = new Map<string, NestedSupportGate[]>();
  const ports = new Map(context.scene.ports.map((p) => [p.portId, p]));
  gates.forEach((g) => {
    const port = required(ports, g.portId),
      key = JSON.stringify([port.sectionId, port.side]);
    const group = groups.get(key) ?? [];
    group.push(g);
    groups.set(key, group);
  });
  groups.forEach((group) => {
    const ordered = group.toSorted((a, b) => a.preferred - b.preferred);
    ordered
      .slice(1)
      .forEach((g, ordinal) =>
        orderMouths(context, required(ports, g.portId), ordered[ordinal], g),
      );
  });
}
function orderMouths(
  context: MouthContext,
  port: PrototypePortLocation,
  previous: NestedSupportGate | undefined,
  next: NestedSupportGate,
): void {
  if (previous === undefined) return reject('missing-contact', [next.portId]);
  const drive = required(context.input.final, `drive:${next.portId}`),
    priorDrive = required(context.input.final, `drive:${previous.portId}`);
  const priorPort = context.scene.ports.find((p) => p.portId === previous.portId);
  if (priorPort === undefined) return reject('missing-contact', [previous.portId]);
  const gap =
    tangentialReach(context, priorPort, priorDrive)[1] + tangentialReach(context, port, drive)[0];
  directedRelation(
    context.graph,
    1,
    required(context.graph.anchors, `${previous.portId}:center`),
    required(context.graph.anchors, `${next.portId}:center`),
    gap,
    'gate-tangent',
    [previous.portId, next.portId],
  );
}

function footprintIndex(
  footprints: readonly NestedSupportFootprint[],
): ReadonlyMap<string, readonly NestedSupportFootprint[]> {
  const index = new Map<string, NestedSupportFootprint[]>();
  footprints.forEach((footprint) =>
    footprint.roadKeys.forEach((key) => {
      const group = index.get(key) ?? [];
      group.push(footprint);
      index.set(key, group);
    }),
  );
  return index;
}
