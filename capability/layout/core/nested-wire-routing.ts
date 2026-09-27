import type { NestedSceneSpec } from '../contract/records/nested-scene-spec.js';
import type { PrototypeNode } from '../contract/records/road-prototype.js';
import type {
  PrototypeBlock,
  PrototypeLayoutMeasure,
  PrototypePoint,
  PrototypePortLocation,
} from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import type { NestedWire, NestedWireResult } from '../contract/records/nested-wires.js';
import type { Access, Terminal, WireRegistry } from './nested-wire-access.js';
import { access, gateTerminal, nodeTerminal } from './nested-wire-access.js';
import type { Leg, LegPreference } from './nested-wire-law.js';
import { lawLeg, lawPreference } from './nested-wire-law.js';

interface State {
  readonly offset: number;
  readonly terminal: Terminal;
  readonly legs: readonly Leg[];
  readonly gates: readonly string[];
}
interface Boundary {
  readonly section: PrototypeBlock;
  readonly exiting: boolean;
}
function ancestry(
  scene: RoadPrototypeScene,
  id: string | null,
): readonly PrototypeBlock[] {
  const section = scene.sections.find((s) => s.id === id);
  if (section === undefined) return [];
  return [section, ...ancestry(scene, section.parentSectionId ?? null)];
}
function boundaries(
  scene: RoadPrototypeScene,
  from: string,
  to: string,
): readonly Boundary[] {
  const source = ancestry(scene, scene.nodes.find((n) => n.id === from)?.sectionId ?? null);
  const target = ancestry(scene, scene.nodes.find((n) => n.id === to)?.sectionId ?? null);
  const common = new Set(source.filter((s) => target.some((t) => s.id === t.id)).map((s) => s.id));
  return [
    ...source.filter((s) => !common.has(s.id)).map((section) => ({ section, exiting: true })),
    ...target
      .filter((s) => !common.has(s.id))
      .toReversed()
      .map((section) => ({ section, exiting: false })),
  ];
}
function alignment(
  source: PrototypePoint,
  target: PrototypePoint,
) {
  const dx = target.x - source.x,
    dy = target.y - source.y;
  return { right: dx, bottom: dy, left: -dx, top: -dy };
}
function cross(
  scene: RoadPrototypeScene,
  registry: WireRegistry,
  state: State,
  boundary: Boundary,
  target: Terminal,
): State | null {
  const { section, exiting } = boundary;
  const owner = exiting ? section.id : (section.parentSectionId ?? null);
  const ports = scene.ports.filter(
    (p) => p.nodeId === section.id && p.role === (exiting ? 'exit' : 'entry'),
  );
  const scores = alignment(state.terminal.point, target.point);
  const normal = exiting ? 1 : -1;
  const distance = (port: PrototypePortLocation) =>
    manhattan(state.terminal.point, port.point) + manhattan(port.point, target.point);
  const ordered = ports.toSorted(
    (a, b) => distance(a) - distance(b) || normal * (scores[b.side] - scores[a.side]),
  );
  return firstGate(ordered, registry, state, boundary, owner);
}
function manhattan(
  a: PrototypePoint,
  b: PrototypePoint,
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
interface GateChoice {
  readonly port: PrototypePortLocation;
  readonly approach: Access;
  readonly departure: Access;
  readonly preference: LegPreference;
}
function gateChoice(
  port: PrototypePortLocation,
  registry: WireRegistry,
  state: State,
  boundary: Boundary,
  owner: string | null,
): readonly GateChoice[] {
  const approach = access(registry, port.portId, owner);
  const departure = access(registry, port.portId, departureOwner(boundary));
  if (approach === undefined || departure === undefined) return [];
  return [
    {
      port,
      approach,
      departure,
      preference: lawPreference(state.terminal, gateTerminal(approach)),
    },
  ];
}
function firstGate(
  ports: readonly PrototypePortLocation[],
  registry: WireRegistry,
  state: State,
  boundary: Boundary,
  owner: string | null,
): State | null {
  const choices = ports.flatMap((port) => gateChoice(port, registry, state, boundary, owner));
  // Nearest gate first; a gate whose leg cannot be routed yields to the next one.
  for (const choice of choices) {
    const next = gateLeg(registry, state, choice);
    if (next !== null) return next;
  }
  return null;
}
function gateLeg(
  registry: WireRegistry,
  state: State,
  choice: GateChoice,
): State | null {
  const leg = lawLeg(
    state.terminal,
    gateTerminal(choice.approach),
    registry,
    state.offset,
    choice.preference,
  );
  if (leg === null) return null;
  return {
    offset: state.offset,
    terminal: gateTerminal(choice.departure),
    legs: [...state.legs, leg],
    gates: [...state.gates, choice.port.portId],
  };
}
function advance(
  scene: RoadPrototypeScene,
  registry: WireRegistry,
  state: State | null,
  boundary: Boundary,
  target: Terminal,
): State | null {
  if (state === null) return null;
  return cross(scene, registry, state, boundary, target);
}
function route(
  scene: RoadPrototypeScene,
  registry: WireRegistry,
  id: string,
  from: string,
  to: string,
  offset: number,
  sourcePort?: string,
  targetPort?: string,
): NestedWire | null {
  const source = nodeTerminal(registry, from, 'exit', sourcePort),
    target = nodeTerminal(registry, to, 'entry', targetPort);
  if (source === undefined || target === undefined) return null;
  const state = boundaries(scene, from, to).reduce<State | null>(
    (s, b) => advance(scene, registry, s, b, target),
    { terminal: source, legs: [], gates: [], offset },
  );
  if (state === null) return null;
  return finish(registry, id, from, to, state, target);
}
function finish(
  registry: WireRegistry,
  id: string,
  from: string,
  to: string,
  state: State,
  target: Terminal,
): NestedWire | null {
  const leg = lawLeg(state.terminal, target, registry, state.offset);
  if (leg === null) return null;
  const legs = [...state.legs, leg];
  const segments = legs.flatMap((l) => l.segments);
  return {
    id,
    from,
    to,
    sourcePortId: legs[0]?.source.portId ?? leg.source.portId,
    targetPortId: leg.target.portId,
    gates: state.gates,
    segments,
  };
}
/** Atomic deterministic wire set. Failure keeps the frozen scene usable; callers own display/retry. */
export function routeNestedWires(
  scene: RoadPrototypeScene,
  registry: WireRegistry,
  measure: PrototypeLayoutMeasure,
  requests: NestedSceneSpec['requests'],
): NestedWireResult {
  // Last resort: a route may pass behind a node rather than fail; notices report it.
  const behind = { ...registry, bodies: [] };
  const wires = requests.map(([from, to, sourcePort, targetPort], i) => {
    const id = `w${String(i + 1).padStart(2, '0')}`;
    const attempt = (r: WireRegistry) =>
      route(scene, r, id, `node-${from}`, `node-${to}`, 0, sourcePort, targetPort);
    return measure(`wire:${id}`, () => attempt(registry) ?? attempt(behind));
  });
  const failed = wires.findIndex((w) => w === null);
  if (failed >= 0)
    return {
      ok: false,
      error: {
        code: 'unroutable-leg',
        wireId: `w${String(failed + 1).padStart(2, '0')}`,
        ownerId: 'frozen-scene',
      },
    };
  return { ok: true, value: wires.flatMap((w) => (w === null ? [] : [w])) };
}

function departureOwner(boundary: Boundary): string | null {
  if (boundary.exiting) return boundary.section.parentSectionId ?? null;
  return boundary.section.id;
}

/** Resolve app automatic sides once from the measured placement before constructing driveways. */
export function resolveNestedRequests(
  nodes: readonly PrototypeNode[],
  requests: NestedSceneSpec['requests'],
): NestedSceneSpec['requests'] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return requests.map(([from, to, source, target]) => {
    const a = byId.get(`node-${from}`),
      b = byId.get(`node-${to}`);
    if (a === undefined || b === undefined) throw new Error('Missing wire endpoint');
    return [from, to, resolvedPort(source, a, b, false), resolvedPort(target, b, a, true)];
  });
}
function resolvedPort(
  id: string | undefined,
  own: PrototypeNode,
  other: PrototypeNode,
  target: boolean,
): string | undefined {
  if (id === undefined || !id.includes(':auto:')) return id;
  const dx = other.bounds.x + other.bounds.width / 2 - own.bounds.x - own.bounds.width / 2;
  const dy = other.bounds.y + other.bounds.height / 2 - own.bounds.y - own.bounds.height / 2;
  const member = id.split(':auto:')[1] !== '';
  const horizontal = member || Math.abs(dx) >= Math.abs(dy);
  const side = horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  return id.replace(':auto:', `:${target && own.id === other.id && !member ? 'bottom' : side}:`);
}
