import type { readNestedProjectionSupports } from './nested-lane-projection.js';
import type { NestedWire } from '../contract/records/nested-wires.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import type { SectionPlacement } from './prototype-nested-placement.js';
import type { RoadContact } from './prototype-road-registry.js';
import type { NestedSupportRequest } from '../contract/records/nested-support.js';
import type { PrototypeRoad, PrototypeLayoutMeasure } from '../contract/records/road-prototype.js';
import {
  positionNestedSections,
  sizeNestedSections,
  nestedLaneWidth,
} from './prototype-nested-placement.js';
import {
  nestedMainRoads,
  nestedDriveways,
  nestedBodies,
  nestedCrossings,
  streetMeets,
} from './prototype-nested-roads.js';
import { roadRegistry, frameEnds, constructedContacts } from './prototype-road-registry.js';
import { wireRegistry } from './nested-wire-registry.js';
import { routeNestedWires } from './nested-wire-routing.js';
import { allocateNestedLanes } from './nested-wire-lanes.js';
import { capacityRoads } from './nested-road-capacity.js';
import { reject, required } from './nested-support-graph.js';

const measure: PrototypeLayoutMeasure = (_stage, run) => run();

/** Replay the authoritative reservation laws once; never route on demand-expanded geometry. */
export function retainSupportInput(request: NestedSupportRequest) {
  const placements = positionNestedSections(sizeNestedSections(request.spec.sections));
  const pitch = placements[0]?.size.measured.lanePitch;
  if (pitch === undefined) throw new Error('Measured lane spacing is required');
  const pitches = { horizontal: pitch, vertical: pitch };
  const origins = new Map<string, readonly string[]>();
  const main = nestedMainRoads(placements, pitches, (road, keys) => origins.set(road.id, keys));
  const drives = placements.flatMap((p) =>
    nestedDriveways(p, main, pitches, nestedBodies(placements)),
  );
  drives.forEach((road) => origins.set(road.id, [driveOrigin(road)]));
  const roads = [...main, ...drives];
  const contacts = constructedContacts(
    roadRegistry(roads),
    [...frameEnds(main), ...nestedCrossings(placements), ...streetMeets(main)],
    drives,
    pitches,
  );
  const reserved = { ...request.scene, roads };
  const registry = wireRegistry(reserved, contacts, measure);
  const plan = routeNestedWires(reserved, registry, measure, request.spec.requests);
  if (!plan.ok) return reject('unroutable-reservation', [plan.error.wireId]);
  const allocation = allocateNestedLanes(plan.value, registry.roads);
  const final = new Map(request.scene.roads.map((road) => [road.id, road]));
  const expected = capacityRoads(roads, allocation.demand, contacts, measure, request.scene.ports);
  expected.roads.forEach((road) => checkRoad(road, required(final, road.id)));
  if (JSON.stringify(request.scene.wireLanes) !== JSON.stringify(allocation.lanes))
    reject('mismatched-contact', ['lane-allocation']);
  return retainedSupportRecords(
    request.scene,
    placements,
    roads,
    contacts,
    origins,
    plan.value,
    allocation,
    final,
  );
}

/** Index the once-selected reservation without replaying any placement/routing/allocation step. */
export function retainedSupportRecords(
  scene: RoadPrototypeScene,
  placements: readonly SectionPlacement[],
  roads: readonly PrototypeRoad[],
  contacts: readonly RoadContact[],
  origins: ReadonlyMap<string, readonly string[]>,
  wires: readonly NestedWire[],
  allocation: ReturnType<typeof allocateNestedLanes>,
  final: ReadonlyMap<string, PrototypeRoad>,
  projectionSupports?: ReturnType<typeof readNestedProjectionSupports>,
) {
  const populations = roads.map((road) => population(road, origins, allocation.demand, final));
  const keys = new Map(populations.map((p) => [p.roadId, p.key]));
  const neighbors = new Map<string, PrototypeRoad[]>();
  contacts.forEach((c) => {
    addNeighbor(neighbors, c.a.id, c.b);
    addNeighbor(neighbors, c.b.id, c.a);
  });
  const retainedContacts = contacts.map((c) => {
    const a = required(keys, c.a.id),
      b = required(keys, c.b.id);
    return { key: JSON.stringify([a, b]), a, b };
  });
  const travels = [...allocation.byWire.values()].flat().map((t) => ({
    key: JSON.stringify([t.wireId, t.first]),
    roadKey: required(keys, t.road.id),
    wireId: t.wireId,
    first: t.first,
    last: t.last,
    direction: t.direction,
    rank: t.lane.index,
    count: t.count,
  }));
  return {
    nodes: new Map(scene.nodes.map((node) => [node.id, node])),
    sections: new Map(scene.sections.map((section) => [section.id, section])),
    projectionSupports,
    placements,
    roads,
    contacts,
    neighbors,
    wires,
    allocation,
    final,
    populations,
    keys,
    retainedContacts,
    travels,
  };
}

/** Semantic driveway provenance is shared by query replay and the once-only builder. */
export function driveOrigin(road: PrototypeRoad): string {
  const access = road.access;
  if (access === null) return reject('missing-contact', [road.id]);
  return JSON.stringify([
    road.sectionId,
    road.axis,
    access.nodeId,
    access.portId,
    access.side,
    access.role,
  ]);
}
function population(
  road: PrototypeRoad,
  origins: ReadonlyMap<string, readonly string[]>,
  demand: ReadonlyMap<string, number>,
  final: ReadonlyMap<string, PrototypeRoad>,
) {
  const current = required(final, road.id);
  const retained = required(origins, road.id);
  const count = demand.get(road.id) ?? 0;
  const width = nestedLaneWidth(count);
  const actual = current.bounds[road.axis === 'horizontal' ? 'height' : 'width'];
  if (actual !== width) reject('mismatched-contact', [road.id], [width], [actual]);
  return {
    key: JSON.stringify([road.sectionId, road.axis, retained]),
    roadId: road.id,
    owner: road.sectionId,
    axis: road.axis,
    origins: retained,
    demand: count,
    width,
  };
}

function checkRoad(
  expected: PrototypeRoad,
  actual: PrototypeRoad,
): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    reject(
      'mismatched-contact',
      [expected.id],
      Object.values(expected.bounds),
      Object.values(actual.bounds),
    );
}

function addNeighbor(
  index: Map<string, PrototypeRoad[]>,
  id: string,
  road: PrototypeRoad,
): void {
  const group = index.get(id) ?? [];
  group.push(road);
  index.set(id, group);
}
