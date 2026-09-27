import type {
  PrototypeLayoutMeasure,
  PrototypePoint,
  PrototypePortLocation,
  PrototypeRoad,
} from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import type { Access, Crossing, Terminal, WireRegistry } from './nested-wire-access.js';
import { center } from './nested-wire-access.js';
import type { RoadContact } from './prototype-road-registry.js';
import { roadRegistry } from './prototype-road-registry.js';

const inverse = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
function contactAccess(
  scene: RoadPrototypeScene,
  drive: PrototypeRoad,
  street: PrototypeRoad,
): Access | undefined {
  const port = scene.ports.find((p) => p.portId === drive.access?.portId);
  if (port === undefined) return undefined;
  return placedAccess(port, drive, street);
}
function placedAccess(
  port: PrototypePortLocation,
  drive: PrototypeRoad,
  street: PrototypeRoad,
): Access {
  const b = drive.bounds;
  const horizontal = drive.axis === 'horizontal';
  const inward = street.sectionId === port.nodeId;
  const side = inward ? inverse[port.side] : port.side;
  const ends = { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
  const mouth = horizontal
    ? { x: ends[side], y: port.point.y }
    : { x: port.point.x, y: ends[side] };
  const join = roadJoin(street, mouth);
  return { portId: port.portId, side, port: port.point, mouth, join, roadId: street.id, drive };
}
function attachAccess(
  index: Map<string, Access>,
  scene: RoadPrototypeScene,
  c: RoadContact,
): void {
  const drive = c.b.kind === 'driveway' ? c.b : c.a;
  const street = c.a === drive ? c.b : c.a;
  const access = contactAccess(scene, drive, street);
  storeAccess(index, access, street.sectionId);
}
/** Ordered road-owned crossings and access terminals are constructed once, before any wire request. */
export function wireRegistry(
  scene: RoadPrototypeScene,
  contacts: readonly RoadContact[],
  measure: PrototypeLayoutMeasure,
): WireRegistry {
  return measure('wire-registry', () => compile(scene, contacts));
}
function compile(
  scene: RoadPrototypeScene,
  contacts: readonly RoadContact[],
): WireRegistry {
  const registry = roadRegistry(scene.roads);
  const crossings = new Map<string, Crossing[]>(),
    accesses = new Map<string, Access>();
  contacts.forEach((c) => {
    if (c.b.kind === 'driveway' || c.a.kind === 'driveway') attachAccess(accesses, scene, c);
    else addCrossing(crossings, registry.entries, c);
  });
  crossings.forEach((value, id) =>
    crossings.set(
      id,
      value.toSorted((a, b) => a.at - b.at),
    ),
  );
  const terminals = new Map<string, Terminal>();
  scene.nodes.forEach((node) =>
    ['entry', 'exit'].forEach((role) =>
      terminals.set(`${node.id}:${role}`, {
        point: center(node),
        accesses: scene.ports
          .filter((p) => p.nodeId === node.id && p.role === role)
          .flatMap((p) => optional(accesses.get(`${p.portId}:${node.sectionId}`))),
      }),
    ),
  );
  return {
    roads: new Map(scene.roads.map((r) => [r.id, r])),
    crossings,
    accesses,
    terminals,
    bodies: scene.nodes.map((node) => node.bounds),
  };
}
function optional(value: Access | undefined): readonly Access[] {
  return value === undefined ? [] : [value];
}
function addCrossing(
  index: Map<string, Crossing[]>,
  entries: ReturnType<typeof roadRegistry>['entries'],
  c: RoadContact,
): void {
  index.set(c.a.id, [
    ...(index.get(c.a.id) ?? []),
    { roadId: c.b.id, at: entries.get(c.b.id)?.at ?? 0 },
  ]);
  index.set(c.b.id, [
    ...(index.get(c.b.id) ?? []),
    { roadId: c.a.id, at: entries.get(c.a.id)?.at ?? 0 },
  ]);
}

function roadJoin(
  street: PrototypeRoad,
  mouth: PrototypePoint,
): PrototypePoint {
  const r = street.bounds;
  return street.axis === 'vertical'
    ? { x: r.x + r.width / 2, y: mouth.y }
    : { x: mouth.x, y: r.y + r.height / 2 };
}
function storeAccess(
  index: Map<string, Access>,
  access: Access | undefined,
  owner: string | null,
): void {
  if (access !== undefined) index.set(`${access.portId}:${owner}`, access);
}
