import type {
  PrototypeRoad,
  PrototypeLayoutMeasure,
  PrototypePortLocation,
} from '../contract/records/road-prototype.js';
import type { RoadContact } from './prototype-road-registry.js';
import { terminalDepth, roadLanePitch } from './nested-terminal-pins.js';
import { axes } from './prototype-road-geometry.js';
import { nestedLaneWidth } from './prototype-nested-placement.js';

/** Preserve the mouth and the full terminal fan even when a street consumes its approach. */
function terminalExtent(
  road: PrototypeRoad,
  port: PrototypePortLocation,
): PrototypeRoad {
  const a = axes[road.axis],
    b = road.bounds;
  // (count - 1) fan rows plus a quarter-pitch forward stem; gates retain their port plane.
  const depth =
    port.nodeId === port.sectionId
      ? 0
      : terminalDepth(port, road.wireLaneCount ?? 0, roadLanePitch(road));
  const sign = ['top', 'left'].includes(port.side) ? -1 : 1;
  const pin = port.point[a.along],
    fan = pin + sign * depth;
  const start = Math.min(b[a.along], pin, fan),
    end = Math.max(b[a.along] + b[a.length], pin, fan);
  return { ...road, bounds: { ...b, [a.along]: start, [a.length]: end - start } };
}
function admitTerminal(
  roads: Map<string, PrototypeRoad>,
  port: PrototypePortLocation,
): void {
  const road = roads.get(`drive:${port.portId}`);
  if (road !== undefined) roads.set(road.id, terminalExtent(road, port));
}

function sized(
  road: PrototypeRoad,
  count: number,
  measuredWidth?: number,
): PrototypeRoad {
  const a = axes[road.axis],
    b = road.bounds,
    width = measuredWidth ?? nestedLaneWidth(count, roadLanePitch(road));
  return {
    ...road,
    wireLaneCount: count,
    bounds: { ...b, [a.across]: b[a.across] + (b[a.breadth] - width) / 2, [a.breadth]: width },
  };
}
/** Entry and exit ports at one physical mouth share its envelope, so nested turns use one boundary. */
function mouthKey(road: PrototypeRoad): string {
  const a = axes[road.axis];
  return JSON.stringify([
    road.access?.nodeId,
    road.access?.side,
    road.axis,
    road.bounds[a.across] + road.bounds[a.breadth] / 2,
  ]);
}
function sharedMouths(roads: readonly PrototypeRoad[]): readonly PrototypeRoad[] {
  const widths = new Map<string, number>();
  roads.forEach((road) => {
    const key = mouthKey(road);
    widths.set(key, Math.max(widths.get(key) ?? 0, road.bounds[axes[road.axis].breadth]));
  });
  return roads.map((road) => sized(road, road.wireLaneCount ?? 0, widths.get(mouthKey(road))));
}
function contactDrive(c: RoadContact): RoadContact | undefined {
  if (c.a.kind === 'driveway') return { a: c.b, b: c.a };
  if (c.b.kind === 'driveway') return c;
  return undefined;
}
function attached(
  drive: PrototypeRoad,
  street: PrototypeRoad,
): PrototypeRoad {
  const a = axes[drive.axis],
    b = drive.bounds,
    s = street.bounds;
  const center = s[a.along] + s[a.length] / 2;
  const high = b[a.along] > center;
  const interval = high
    ? [s[a.along] + s[a.length], b[a.along] + b[a.length]]
    : [b[a.along], s[a.along]];
  const [start = 0, end = 0] = interval;
  return { ...drive, bounds: { ...b, [a.along]: start, [a.length]: end - start } };
}
function attach(
  roads: Map<string, PrototypeRoad>,
  contact: RoadContact,
): void {
  const pair = contactDrive(contact);
  if (pair === undefined) return;
  const drive = roads.get(pair.b.id),
    street = roads.get(pair.a.id);
  attachKnown(roads, drive, street);
}
function attachKnown(
  roads: Map<string, PrototypeRoad>,
  drive: PrototypeRoad | undefined,
  street: PrototypeRoad | undefined,
): void {
  if (drive === undefined || street === undefined) return;
  roads.set(drive.id, attached(drive, street));
}
/** Final geometry consumes demand and construction contacts without rerunning a builder.
 * Every map is invocation-local; callers own reconstruction after an interrupted build.
 */
export function capacityRoads(
  templates: readonly PrototypeRoad[],
  demand: ReadonlyMap<string, number>,
  contacts: readonly RoadContact[],
  measure: PrototypeLayoutMeasure,
  ports: readonly PrototypePortLocation[],
  allocatedWidths?: ReadonlyMap<string, number>,
) {
  const streets = measure('main-roads', () => {
    const result = new Map(
      templates
        .filter((r) => r.kind === 'street')
        .map((r) => [r.id, sized(r, demand.get(r.id) ?? 0, allocatedWidths?.get(r.id))]),
    );
    contacts.forEach((c) => capContact(result, c));
    return [...result.values()];
  });
  const roads = measure('driveways', () => {
    const drives = sharedMouths(
      templates
        .filter((r) => r.kind === 'driveway')
        .map((r) => sized(r, demand.get(r.id) ?? 0, allocatedWidths?.get(r.id))),
    );
    const result = new Map([...streets, ...drives].map((r) => [r.id, r]));
    contacts.forEach((c) => attach(result, c));
    ports.forEach((port) => admitTerminal(result, port));
    return result;
  });
  const finalContacts = contacts.flatMap((c) => finalContact(roads, c));
  return { roads: [...roads.values()], byId: roads, contacts: finalContacts };
}
function finalContact(
  roads: ReadonlyMap<string, PrototypeRoad>,
  c: RoadContact,
): readonly RoadContact[] {
  const a = roads.get(c.a.id),
    b = roads.get(c.b.id);
  if (a === undefined || b === undefined) return [];
  return [{ a, b }];
}

/** End caps meet the final perpendicular street edge, not the reservation width. */
function capped(
  road: PrototypeRoad,
  template: PrototypeRoad,
  neighbor: PrototypeRoad,
): PrototypeRoad {
  const a = axes[road.axis],
    b = road.bounds,
    t = template.bounds,
    n = neighbor.bounds;
  const center = n[a.along] + n[a.length] / 2;
  const low = t[a.along] + t[a.breadth] / 2;
  const high = t[a.along] + t[a.length] - t[a.breadth] / 2;
  const start = center === low ? n[a.along] : b[a.along];
  const end = center === high ? n[a.along] + n[a.length] : b[a.along] + b[a.length];
  return { ...road, bounds: { ...b, [a.along]: start, [a.length]: end - start } };
}
function capContact(
  roads: Map<string, PrototypeRoad>,
  contact: RoadContact,
): void {
  const a = roads.get(contact.a.id),
    b = roads.get(contact.b.id);
  if (a === undefined || b === undefined) return;
  roads.set(a.id, capped(a, contact.a, b));
  roads.set(b.id, capped(b, contact.b, a));
}
