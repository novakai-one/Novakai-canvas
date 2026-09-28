import { preferredSide } from './routing/endpoints.js';
import type { SupplementalMeasurements } from '../contract/types.js';
import type { VisualNode, VisualSection, VisualWire } from '../contract/records/input.js';
import type { EngineScene } from '../contract/records/engine-scene.js';
import type { PlacedNode, Side } from '../contract/records/geometry.js';
import type {
  NestedNodeSpec,
  NestedSectionSpec,
  NestedSceneSpec,
} from '../contract/records/nested-scene-spec.js';
import type {
  PrototypeNodePort,
  PrototypeLayoutMeasure,
} from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import { createNestedRoadScene } from './prototype-nested-scene.js';
import { inspectNestedWires } from './nested-wire-inspection.js';
import { reject } from './validation/outcomes.js';
import { same } from './validation/facts.js';

/** All input dimensions come from Presentation or an authored size; roads can only move boxes. */
function dimensions(node: VisualNode) {
  return {
    width: Math.max(node.width, node.placement?.width ?? 0),
    height: Math.max(node.height, node.placement?.height ?? 0),
  };
}
function required<T>(
  value: T | undefined,
  id: string,
): T {
  if (value === undefined) return reject('invalid-input', id, 'Nested layout identity is missing');
  return value;
}
function portId(
  number: number,
  role: 'entry' | 'exit',
  side: string,
  member: string | null,
): string {
  return `node-${number}:${role}:${side}:${member ?? ''}`;
}
function ports(
  node: VisualNode,
  number: number,
  advance: number,
): readonly PrototypeNodePort[] {
  const { width, height } = dimensions(node);
  const sides: readonly Side[] = ['left', 'right', 'top', 'bottom'];
  const middle = {
    left: { x: 0, y: height / 2 },
    right: { x: width, y: height / 2 },
    top: { x: width / 2, y: 0 },
    bottom: { x: width / 2, y: height },
  };
  return (['entry', 'exit'] as const).flatMap((role) => [
    ...sides.map((side) => ({
      id: portId(number, role, side, null),
      role,
      side,
      offset: middle[side],
      fixed: true,
      advance,
    })),
    ...node.content.anchors.flatMap((anchor) =>
      (['left', 'right'] as const).map((side) => ({
        id: portId(number, role, side, anchor.member),
        role,
        side,
        offset: { x: middle[side].x, y: anchor.y },
        fixed: true,
        advance,
      })),
    ),
  ]);
}
function nodeSpec(
  node: VisualNode,
  number: number,
  advance: number,
): NestedNodeSpec {
  return {
    number,
    label: node.label,
    ...(node.placement === null ? {} : { position: { x: node.placement.x, y: node.placement.y } }),
    measured: { ...dimensions(node), ports: ports(node, number, advance) },
  };
}
function request(
  wire: VisualWire,
  numbers: ReadonlyMap<string, number>,
): NestedSceneSpec['requests'][number] {
  const from = required(numbers.get(wire.source.node), wire.id);
  const to = required(numbers.get(wire.target.node), wire.id);
  return [
    from,
    to,
    portId(from, 'exit', preferredSide(wire, 'source'), wire.source.member),
    portId(to, 'entry', preferredSide(wire, 'target'), wire.target.member),
  ];
}
/** Measured header and envelope share the same Presentation owner as this section. */
function sectionMeasurements(
  source: VisualSection,
  parent: string | null,
): NonNullable<NestedSectionSpec['measured']> {
  const group = source.nodes.find((node) => node.id === parent);
  return {
    ...required(parent === null ? source.envelope : group?.envelope, parent ?? source.id),
    headerWidth: parent === null ? source.title.width : required(group, parent).content.width,
  };
}
function tree(
  source: VisualSection,
  numbers: ReadonlyMap<string, number>,
  parent: string | null,
  number: number,
  advance: number,
): NestedSectionSpec {
  const placement = source.nodes.find((node) => node.id === parent)?.placement;
  return {
    number,
    ...(placement == null ? {} : { position: { x: placement.x, y: placement.y } }),
    measured: sectionMeasurements(source, parent),
    nodes: source.nodes
      .filter((n) => n.parent === parent && n.groupId === null)
      .map((n) => nodeSpec(n, required(numbers.get(n.id), n.id), advance)),
    children: source.nodes
      .filter((n) => n.parent === parent && n.groupId !== null)
      .map((n) => tree(source, numbers, n.id, required(numbers.get(n.id), n.id) + 1, advance)),
  };
}
function placed(
  source: VisualSection,
  numbers: ReadonlyMap<string, number>,
  scene: RoadPrototypeScene,
): readonly PlacedNode[] {
  return source.nodes.map((node) => {
    const number = required(numbers.get(node.id), node.id);
    const engine =
      node.groupId === null
        ? scene.nodes.find((n) => n.id === `node-${number}`)
        : scene.sections.find((s) => s.id === `section-${number + 1}`);
    return {
      id: node.id,
      parent: node.parent,
      sectionId: source.id,
      measured: node,
      box: required(engine, node.id).bounds,
    };
  });
}
/** Translate measured app data into a single custom road calculation. Layout's facade owns rejection. */
export function toEngineScene(
  source: VisualSection,
  metrics: SupplementalMeasurements,
  measure?: PrototypeLayoutMeasure,
  fixedNodes?: readonly PlacedNode[],
): EngineScene {
  const positionedSource = fixedSource(source, fixedNodes);
  const numbers = new Map(source.nodes.map((node, i) => [node.id, i + 1]));
  const spec: NestedSceneSpec = {
    sections: [
      tree(
        positionedSource,
        numbers,
        null,
        1,
        Math.max(
          0,
          ...source.wires.flatMap((w) => [
            metrics.markers[w.sourceMarker].advance,
            metrics.markers[w.targetMarker].advance,
          ]),
        ),
      ),
    ],
    requests: source.wires.map((wire) => request(wire, numbers)),
  };
  const scene = createNestedRoadScene({
    spec,
    fixedGeometry: true,
    annotateTerminals: true,
    annotationEndpoints: source.wires.map((wire) => required(wire.annotationEndpoint, wire.id)),
    annotationWidths: source.wires.map((wire) =>
      wire.labelVisible === false
        ? required(source.envelope, source.id).lanePitch
        : wire.label.width + required(source.envelope, source.id).annotationGap * 2 + 1,
    ),
    annotationPitches: source.wires.map((wire) =>
      wire.labelVisible === false
        ? required(source.envelope, source.id).lanePitch
        : wire.label.height + required(source.envelope, source.id).annotationGap * 2 + 1,
    ),
    lanePitch: {
      horizontal: required(source.envelope, source.id).lanePitch,
      vertical: required(source.envelope, source.id).lanePitch,
    },
    ...(measure === undefined ? {} : { measure }),
  });
  if (scene.embeddingFailure !== undefined)
    return reject('constraint-conflict', source.id, JSON.stringify(scene.embeddingFailure));
  const wiring = required(scene.wiring, source.id);
  if (!wiring.ok) return reject('constraint-conflict', source.id, JSON.stringify(wiring.error));
  const inspection = inspectNestedWires(scene, wiring.value);
  // After a human move, a route behind a node or across a group edge lands with a warning.
  const moved = source.nodes.some((node) => node.placement !== null);
  const failures = moved
    ? [...inspection.corridors, ...inspection.continuity]
    : Object.values(inspection).flat();
  if (failures.length > 0)
    return reject(
      'constraint-conflict',
      source.id,
      'Custom road geometry failed inspection',
      failures,
    );
  return {
    frame: required(scene.sections[0], source.id).bounds,
    nodes: placed(source, numbers, scene),
    roads: scene.roads,
    routing: {
      roads: scene.roads.map(({ id, kind, axis, bounds, access }) => ({
        id,
        kind,
        axis,
        bounds,
        accessRole: access?.role ?? null,
      })),
      lanes: scene.lanes.map(({ id, roadId, direction, bounds }) => ({
        id,
        roadId,
        direction,
        bounds,
      })),
    },
    blocks: scene.nodes.map((node) => ({
      nodeId: required(source.nodes[Number(node.id.slice(5)) - 1], node.id).id,
      bounds: node.bounds,
      memberPorts: node.ports,
    })),
    wires: wiring.value.map((wire, i) => ({
      wireId: required(source.wires[i], wire.id).id,
      path: [...wire.segments.slice(0, 1).map((s) => s.from), ...wire.segments.map((s) => s.to)],
      lanes: wire.segments.flatMap((s) => (s.laneId === undefined ? [] : [s.laneId])),
    })),
  };
}

/** Route-only supplies existing boxes; manual moves use the same parent-local representation on reload. */
export function fixedSource(
  source: VisualSection,
  fixed?: readonly PlacedNode[],
): VisualSection {
  if (fixed === undefined) return source;
  return {
    ...source,
    nodes: source.nodes.map((node) => {
      const box = required(
        fixed.find((item) => item.id === node.id),
        node.id,
      ).box;
      const size = node.envelope ?? dimensions(node);
      same([size.width, size.height], [box.width, box.height], node.id);
      const parent = fixed.find((item) => item.id === node.parent)?.box ?? { x: 0, y: 0 };
      return {
        ...node,
        placement: { ...box, x: box.x - parent.x, y: box.y - parent.y, locked: true },
      };
    }),
  };
}
