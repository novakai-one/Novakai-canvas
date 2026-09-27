import { retainedSupportRecords, driveOrigin } from './nested-support-input.js';
import { prepareNestedEmbedding } from './nested-embedding.js';
import {
  readNestedAdjustmentEvidence,
  readNestedProjectionSupports,
} from './nested-lane-projection.js';
import { roadContactAreas } from './prototype-road-network.js';
import { SupportRejection } from './nested-support-graph.js';
import type { NestedSceneSpec } from '../contract/records/nested-scene-spec.js';
import { wireRegistry } from './nested-wire-registry.js';
import { roadRegistry, constructedContacts, frameEnds } from './prototype-road-registry.js';
import { routeNestedWires, resolveNestedRequests } from './nested-wire-routing.js';
import { allocateNestedLanes, type LaneAnnotation } from './nested-wire-lanes.js';
import { capacityRoads } from './nested-road-capacity.js';
import { projectNestedWires } from './nested-lane-projection.js';
import type { PrototypeLayoutOptions } from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import {
  sizeNestedSections,
  positionNestedSections,
  nestedLaneWidth,
  nestedLanePitch,
} from './prototype-nested-placement.js';
import {
  nestedMainRoads,
  nestedDriveways,
  nestedBodies,
  nestedSectionPorts,
  nestedCrossings,
  streetMeets,
} from './prototype-nested-roads.js';
import { readPrototypeNodePorts } from './prototype-road-nodes.js';
import { roadNetwork } from './prototype-road-network.js';

/** Reservation topology → law demand → final geometry → network → lane projection, each once.
 * The caller owns reconstruction; no committed scene or shared state is mutated on failure.
 */
export function createNestedRoadScene(
  options: Pick<
    PrototypeLayoutOptions,
    | 'measure'
    | 'sectionInPortsLeft'
    | 'lanePitch'
    | 'annotateTerminals'
    | 'annotationTerminalLimit'
    | 'annotationPitches'
    | 'annotationWidths'
    | 'annotationEndpoints'
  > & {
    readonly fixedGeometry: true;
    readonly spec: NestedSceneSpec;
    readonly lanePitch: { readonly horizontal: number; readonly vertical: number };
    readonly annotateTerminals: true;
    readonly annotationEndpoints: readonly ('source' | 'target')[];
    readonly annotationPitches: readonly number[];
    readonly annotationWidths: readonly number[];
  },
): RoadPrototypeScene {
  if (options.fixedGeometry !== true) throw new Error('Owner geometry must remain fixed');
  if (options.annotateTerminals !== true) throw new Error('Measured annotations are required');
  if (
    ![options.lanePitch.horizontal, options.lanePitch.vertical].every(
      (pitch) => Number.isFinite(pitch) && pitch > 0,
    )
  )
    throw new Error('Positive measured road spacing is required');
  if (
    ![options.annotationEndpoints, options.annotationPitches, options.annotationWidths].every(
      (values) => values.length === options.spec.requests.length,
    )
  )
    throw new Error('Every wire requires measured annotation ownership and spacing');
  if (!options.annotationEndpoints.every((side) => side === 'source' || side === 'target'))
    throw new Error('Every wire requires an annotation endpoint');
  if (
    ![...options.annotationPitches, ...options.annotationWidths].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('Annotation spacing must be finite and positive');
  const measure = options.measure ?? ((_stage, run) => run());
  const spec = options.spec;
  const capacity = measure('capacity', () => sizeNestedSections(spec.sections));
  const initial = measure('nodes', () => positionNestedSections(capacity));
  const requests = resolveNestedRequests(
    initial.flatMap((p) => p.nodes),
    spec.requests,
  );
  const placement = activePorts(initial, requests);
  const sections = placement.map((p) => p.section),
    nodes = placement.flatMap((p) => p.nodes);
  const ports = measure('ports', () => [
    ...nodes.flatMap(readPrototypeNodePorts),
    ...placement.flatMap(nestedSectionPorts),
  ]);
  const topology = measure('topology', () => {
    const origins = new Map<string, readonly string[]>();
    const main = nestedMainRoads(placement, options.lanePitch, (road, keys) =>
        origins.set(road.id, keys),
      ),
      drives = placement.flatMap((p) =>
        nestedDriveways(p, main, options.lanePitch, nestedBodies(placement)),
      );
    drives.forEach((road) => origins.set(road.id, [driveOrigin(road)]));
    const roads = [...main, ...drives].map((road) => ({
      ...road,
      lanePitch: options.lanePitch[road.axis],
    }));
    const contacts = constructedContacts(
      roadRegistry(roads),
      [...frameEnds(main), ...nestedCrossings(placement), ...streetMeets(main)],
      roads.filter((road) => road.kind === 'driveway'),
      options.lanePitch,
    );
    return { roads, contacts, origins };
  });
  const reserved: RoadPrototypeScene = {
    sections,
    nodes,
    ports,
    roads: topology.roads,
    roadWidth: nestedLaneWidth(0, options.lanePitch.horizontal),
    drivewayWidth: nestedLaneWidth(0, options.lanePitch.vertical),
    lanes: [],
    junctions: [],
    dividers: [],
    connections: [],
    crossingExamples: [],
  };
  const registry = wireRegistry(reserved, topology.contacts, measure);
  const plan = routeNestedWires(reserved, registry, measure, requests);
  if (!plan.ok) return { ...reserved, wiring: plan };
  const configuredRoads = terminalCapacity(topology.roads, plan.value, options);
  const configured = new Map(configuredRoads.map((road) => [road.id, road]));
  const annotations = measuredAnnotations(plan.value, options);
  const allocation = measure('lane-allocation', () =>
    allocateNestedLanes(plan.value, configured, annotations),
  );
  const final = capacityRoads(
    configuredRoads,
    allocation.demand,
    topology.contacts,
    measure,
    ports,
    annotations === undefined ? undefined : allocation.widths,
  );
  /** Wires on the roads as they are, with no widening. Unchecked only as the last resort; scene checks still apply. */
  const plainScene = (checked = true): RoadPrototypeScene => {
    const network = measure('network', () => roadNetwork(final.roads, final.contacts));
    const wires = measure('lane-projection', () =>
      projectNestedWires(
        plan.value,
        allocation.byWire,
        final.byId,
        network.junctions,
        ports,
        checked,
      ),
    );
    return {
      ...reserved,
      roads: final.roads,
      ...network,
      wireLanes: allocation.lanes,
      wiring: { ok: true, value: wires },
    };
  };
  try {
    if (options.fixedGeometry) return plainScene();
    const supports = readNestedProjectionSupports(plan.value, allocation.byWire, final.byId);
    const supportScene: RoadPrototypeScene = {
      ...reserved,
      roads: final.roads,
      wireLanes: allocation.lanes,
      wiring: {
        ok: true,
        value: readNestedAdjustmentEvidence(supports, final.byId, () =>
          roadContactAreas(final.roads, final.contacts),
        ),
      },
    };
    const input = retainedSupportRecords(
      supportScene,
      placement,
      configuredRoads,
      topology.contacts,
      topology.origins,
      plan.value,
      allocation,
      final.byId,
      supports,
    );
    return finish(input, supportScene, measure, plainScene);
  } catch (error) {
    return plainFallback(
      { ...reserved, roads: final.roads, wireLanes: allocation.lanes },
      error,
      plainScene,
    );
  }
}
function finish(
  input: Parameters<typeof prepareNestedEmbedding>[0],
  reserved: RoadPrototypeScene,
  measure: NonNullable<PrototypeLayoutOptions['measure']>,
  plainScene: (checked: boolean) => RoadPrototypeScene,
): RoadPrototypeScene {
  try {
    return embeddedScene(input, reserved, measure);
  } catch (error) {
    return plainFallback(reserved, error, plainScene);
  }
}
/** When roads cannot be widened to fit their wires, keep the wires on the current roads rather than reject the edit. */
function plainFallback(
  reserved: RoadPrototypeScene,
  error: unknown,
  plainScene: (checked: boolean) => RoadPrototypeScene,
): RoadPrototypeScene {
  if (!(error instanceof SupportRejection)) throw error;
  try {
    return plainScene(false);
  } catch {
    return rejectedScene(reserved, error);
  }
}
function embeddedScene(
  input: Parameters<typeof prepareNestedEmbedding>[0],
  reserved: RoadPrototypeScene,
  measure: NonNullable<PrototypeLayoutOptions['measure']>,
): RoadPrototypeScene {
  const prepared = prepareNestedEmbedding(input, reserved);
  const network = measure('network', () => roadNetwork(prepared.roads, prepared.contacts));
  const wires = measure('lane-projection', () =>
    projectNestedWires(
      prepared.wires,
      prepared.byWire,
      prepared.byId,
      network.junctions,
      prepared.scene.ports,
    ),
  );
  return {
    ...prepared.scene,
    roads: prepared.roads,
    ...network,
    wireLanes: prepared.lanes,
    wiring: { ok: true, value: wires },
  };
}

function rejectedScene(
  scene: RoadPrototypeScene,
  error: SupportRejection,
): RoadPrototypeScene {
  const unwired = { ...scene };
  delete unwired.wiring;
  return { ...unwired, embeddingFailure: error.evidence };
}

/** Only authored attachments own driveways; unused app handles do not create duplicate roads. */
function activePorts(
  placements: ReturnType<typeof positionNestedSections>,
  requests: NestedSceneSpec['requests'],
): ReturnType<typeof positionNestedSections> {
  const selected = new Set(requests.flatMap((request) => request.slice(2)));
  const automatic = new Set(
    requests.flatMap(([from, to, source, target]) => [
      ...(source === undefined ? [`node-${from}:exit`] : []),
      ...(target === undefined ? [`node-${to}:entry`] : []),
    ]),
  );
  return placements.map((placement) => ({
    ...placement,
    nodes: placement.nodes.map((node) => ({
      ...node,
      ports: node.ports.filter(
        (port) => selected.has(port.id) || automatic.has(`${node.id}:${port.role}`),
      ),
    })),
  }));
}

/** Honor owner-selected annotations; legacy callers choose the less crowded approach. */
function terminalCapacity(
  roads: RoadPrototypeScene['roads'],
  wires: readonly import('../contract/records/nested-wires.js').NestedWire[],
  options: Pick<
    PrototypeLayoutOptions,
    | 'lanePitch'
    | 'annotateTerminals'
    | 'annotationTerminalLimit'
    | 'annotationPitches'
    | 'annotationWidths'
    | 'annotationEndpoints'
  >,
): RoadPrototypeScene['roads'] {
  if (!options.annotateTerminals) return roads;
  const counts = new Map<string, number>();
  const pitches = new Map<string, number>();
  wires.forEach((wire, index) =>
    new Set(wire.segments.map((segment) => segment.corridorId)).forEach((id) => {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      pitches.set(id, Math.max(pitches.get(id) ?? 0, options.annotationPitches?.[index] ?? 0));
    }),
  );
  const annotated = new Set(
    wires.map((wire, index) => {
      const source = `drive:${wire.sourcePortId}`,
        target = `drive:${wire.targetPortId}`;
      const selected = options.annotationEndpoints?.[index];
      if (selected !== undefined) return selected === 'source' ? source : target;
      return (counts.get(source) ?? 0) <= (counts.get(target) ?? 0) ? source : target;
    }),
  );
  return roads.map((road) => {
    if (road.access === null || road.access.nodeId === road.sectionId) return road;
    if (options.annotationEndpoints !== undefined)
      return { ...road, lanePitch: options.lanePitch?.[road.axis] ?? nestedLanePitch };
    const annotatedRoad = {
      ...road,
      lanePitch: pitches.get(road.id) || road.lanePitch || nestedLanePitch,
    };
    if (annotated.has(road.id)) return annotatedRoad;
    if ((counts.get(road.id) ?? 0) <= (options.annotationTerminalLimit ?? 3)) return annotatedRoad;
    return { ...road, lanePitch: options.lanePitch?.[road.axis] ?? nestedLanePitch };
  });
}

/** Explicit owner choices allocate label room per wire, never to every wire sharing its port. */
function measuredAnnotations(
  wires: readonly import('../contract/records/nested-wires.js').NestedWire[],
  options: Pick<
    PrototypeLayoutOptions,
    'annotationEndpoints' | 'annotationPitches' | 'annotationWidths'
  >,
): ReadonlyMap<string, LaneAnnotation> | undefined {
  if (options.annotationEndpoints === undefined) return undefined;
  return new Map(
    wires.flatMap((wire, index) => {
      const owner = options.annotationEndpoints?.[index];
      if (owner === undefined) return [];
      const port = owner === 'source' ? wire.sourcePortId : wire.targetPortId;
      return [
        [
          wire.id,
          {
            roadId: `drive:${port}`,
            pitch: options.annotationPitches?.[index] ?? nestedLanePitch,
            verticalPitch:
              options.annotationWidths?.[index] ??
              options.annotationPitches?.[index] ??
              nestedLanePitch,
          },
        ],
      ];
    }),
  );
}
