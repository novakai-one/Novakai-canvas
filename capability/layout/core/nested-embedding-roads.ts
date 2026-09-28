import type { PrototypeRoad, PrototypePortLocation } from '../contract/records/road-prototype.js';
import type {
  NestedSupportLedger,
  NestedSupportSpanGrowth,
} from '../contract/records/nested-support.js';
import { axes } from './prototype-road-geometry.js';
import { reject, required } from './nested-support-graph.js';
import type { RoadContact } from './prototype-road-registry.js';

interface Context {
  readonly values: ReadonlyMap<string, number>;
  readonly old: ReadonlyMap<string, number>;
  readonly keys: ReadonlyMap<string, string>;
  readonly growth: ReadonlyMap<string, NestedSupportSpanGrowth>;
}
function street(
  road: PrototypeRoad,
  context: Context,
): PrototypeRoad {
  const { values, old, keys } = context,
    key = required(keys, road.id),
    a = axes[road.axis],
    b = road.bounds;
  const start = b[a.along] + required(values, `${key}:start`) - required(old, `${key}:start`);
  const end =
    b[a.along] + b[a.length] + required(values, `${key}:end`) - required(old, `${key}:end`);
  const at = required(values, key);
  const across = context.growth.get(JSON.stringify([road.id, a.across]));
  const along = context.growth.get(JSON.stringify([road.id, a.along]));
  const negative = along?.negative ?? 0;
  const positive = along?.positive ?? 0;
  const id = `${road.sectionId ?? 'world'}:${road.axis}:${at}:${required(values, `${key}:start`)}`;
  return {
    ...road,
    id,
    bounds: {
      ...b,
      [a.across]: at - b[a.breadth] / 2 - (across?.negative ?? 0),
      [a.breadth]: b[a.breadth] + (across?.negative ?? 0) + (across?.positive ?? 0),
      [a.along]: start - negative,
      [a.length]: end - start + negative + positive,
    },
  };
}
function drive(
  road: PrototypeRoad,
  context: Context,
  streets: readonly PrototypeRoad[],
  port: PrototypePortLocation,
): PrototypeRoad {
  const a = axes[road.axis],
    b = road.bounds;
  const endpoints = streets.map((s) => streetEdge(s, port, a.along, a.length));
  if (port.nodeId !== port.sectionId) endpoints.push(port.point[a.along]);
  const start = Math.min(...endpoints),
    end = Math.max(...endpoints);
  return {
    ...road,
    bounds: {
      ...b,
      [a.across]: required(context.values, required(context.keys, road.id)) - b[a.breadth] / 2,
      [a.along]: start,
      [a.length]: end - start,
    },
  };
}
function streetEdge(
  street: PrototypeRoad,
  port: PrototypePortLocation,
  along: 'x' | 'y',
  length: 'width' | 'height',
): number {
  const b = street.bounds,
    center = b[along] + b[length] / 2;
  if (center < port.point[along]) return b[along] + b[length];
  return b[along];
}

function neighbors(contacts: readonly RoadContact[]) {
  const index = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const group = index.get(a) ?? [];
    group.push(b);
    index.set(a, group);
  };
  contacts.forEach((c) => {
    add(c.a.id, c.b.id);
    add(c.b.id, c.a.id);
  });
  return index;
}
function materializeDrive(
  road: PrototypeRoad,
  context: Context,
  byOldId: ReadonlyMap<string, PrototypeRoad>,
  adjacent: ReadonlyMap<string, readonly string[]>,
  ports: ReadonlyMap<string, PrototypePortLocation>,
) {
  if (road.access === null) return reject('missing-contact', [road.id]);
  const streets = (adjacent.get(road.id) ?? []).map((id) => required(byOldId, id));
  return drive(road, context, streets, required(ports, road.access.portId));
}

/** One bijection preserves construction merge identities and contacts; no coordinate-based rediscovery.
 * Recovery is pure reconstruction. Nominal demand widths retain recorded support/cap growth.
 */
export function embedNestedRoads(
  roads: readonly PrototypeRoad[],
  contacts: readonly RoadContact[],
  ledger: NestedSupportLedger,
  values: ReadonlyMap<string, number>,
  old: ReadonlyMap<string, number>,
  ports: readonly PrototypePortLocation[],
) {
  const context: Context = {
    values,
    old,
    growth: new Map((ledger.spanGrowth ?? []).map((g) => [JSON.stringify([g.roadId, g.axis]), g])),
    keys: new Map(ledger.populations.map((p) => [p.roadId, p.key])),
  };
  const byOldId = new Map(
    roads.filter((r) => r.kind === 'street').map((r) => [r.id, street(r, context)]),
  );
  const adjacent = neighbors(contacts),
    byPort = new Map(ports.map((p) => [p.portId, p]));
  roads
    .filter((r) => r.kind === 'driveway')
    .forEach((r) => byOldId.set(r.id, materializeDrive(r, context, byOldId, adjacent, byPort)));
  const moved = roads.map((r) => required(byOldId, r.id));
  const byId = new Map(moved.map((r) => [r.id, r]));
  if (byId.size !== roads.length)
    reject('mismatched-contact', ['road-identity-bijection'], [roads.length], [byId.size]);
  const finalContacts = contacts.map((c) => ({
    a: required(byOldId, c.a.id),
    b: required(byOldId, c.b.id),
  }));
  return { roads: moved, byOldId, byId, contacts: finalContacts };
}
