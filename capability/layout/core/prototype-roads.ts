import { roadRegistry, constructedContacts, frameEnds } from './prototype-road-registry.js';
import type {
  PrototypeBounds,
  PrototypeBlock,
  PrototypeRoad,
  PrototypeLayoutOptions,
  PrototypeLayoutMeasure,
} from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import { roadNetwork } from './prototype-road-network.js';
import {
  placePrototypeNode,
  readPrototypeNodePorts,
  measuredNode,
} from './prototype-road-nodes.js';
import { attachPrototypeDriveways } from './prototype-road-driveways.js';

const drivewayWidth = 24,
  drivewayLength = 48,
  blockGap = 80,
  margin = 48,
  inset = 24,
  streetTop = 80;
/** Capacity is chosen once. Wider roads reserve more space before any node is placed. */
function capacity(
  roadWidth: number,
  node: { readonly width: number; readonly height: number },
) {
  if (!Number.isFinite(roadWidth) || roadWidth < 48)
    throw new RangeError('Road width must be finite and at least 48');
  return {
    roadWidth,
    blockWidth: inset * 2 + roadWidth * 2 + drivewayLength * 2 + node.width,
    blockHeight: streetTop + roadWidth * 2 + drivewayLength * 2 + node.height + inset,
    nodeLeft: inset + roadWidth + drivewayLength,
    nodeTop: streetTop + roadWidth + drivewayLength,
    streetBottom: streetTop + roadWidth + drivewayLength * 2 + node.height,
  };
}
type Capacity = ReturnType<typeof capacity>;
function section(
  label: string,
  index: number,
  plan: Capacity,
): PrototypeBlock {
  return {
    id: `section-${index + 1}`,
    label,
    bounds: {
      x: margin + index * (plan.blockWidth + blockGap),
      y: margin,
      width: plan.blockWidth,
      height: plan.blockHeight,
    },
  };
}
function placed(
  section: PrototypeBlock,
  x: number,
  y: number,
  width: number,
  height: number,
): PrototypeBounds {
  return { x: section.bounds.x + x, y: section.bounds.y + y, width, height };
}
function streets(
  section: PrototypeBlock,
  plan: Capacity,
): readonly PrototypeRoad[] {
  return [
    ...[streetTop, plan.streetBottom].map((y, index): PrototypeRoad => ({
      id: `${section.id}-street-horizontal-${index}`,
      sectionId: section.id,
      kind: 'street',
      access: null,
      axis: 'horizontal',
      directions: ['left', 'right'],
      bounds: placed(section, inset, y, plan.blockWidth - inset * 2, plan.roadWidth),
    })),
    ...[inset, plan.blockWidth - inset - plan.roadWidth].map((x, index): PrototypeRoad => ({
      id: `${section.id}-street-vertical-${index}`,
      sectionId: section.id,
      kind: 'street',
      access: null,
      axis: 'vertical',
      directions: ['down', 'up'],
      bounds: placed(
        section,
        x,
        streetTop,
        plan.roadWidth,
        plan.streetBottom + plan.roadWidth - streetTop,
      ),
    })),
  ];
}
function mainRoads(
  sections: readonly PrototypeBlock[],
  plan: Capacity,
): readonly PrototypeRoad[] {
  const connector: PrototypeRoad = {
    id: 'road-between-sections',
    sectionId: null,
    kind: 'street',
    access: null,
    axis: 'horizontal',
    directions: ['left', 'right'],
    bounds: {
      x: margin + plan.blockWidth - inset,
      y: margin + streetTop,
      width: blockGap + inset * 2,
      height: plan.roadWidth,
    },
  };
  return [connector, ...sections.flatMap((item) => streets(item, plan))];
}
const unmeasured: PrototypeLayoutMeasure = (_stage, operation) => operation();
/** One forward pass: capacity → nodes → owned ports → main roads → driveways → lane network.
 * There is no geometry feedback, convergence loop or DOM measurement. Caller owns any timing.
 * Invalid roadWidth throws RangeError; callers correct the option and safely retry.
 */
export function createRoadPrototypeScene(
  options: PrototypeLayoutOptions & {
    readonly measured?: import('../contract/records/nested-scene-spec.js').NestedNodeSpec['measured'];
  } = {},
): RoadPrototypeScene {
  const measure = options.measure ?? unmeasured;
  const measured = measuredNode({ measured: options.measured });
  const plan = measure('capacity', () => capacity(options.roadWidth ?? 48, measured));
  const sections = ['Section A', 'Section B'].map((label, index) => section(label, index, plan));
  const nodes = measure('nodes', () =>
    sections.map((item, index) =>
      placePrototypeNode(
        item.id,
        index,
        {
          x: item.bounds.x + plan.nodeLeft,
          y: item.bounds.y + plan.nodeTop,
        },
        measured,
      ),
    ),
  );
  const ports = measure('ports', () => nodes.flatMap(readPrototypeNodePorts));
  const main = measure('main-roads', () => mainRoads(sections, plan));
  const driveways = measure('driveways', () =>
    attachPrototypeDriveways(ports, main, drivewayWidth),
  );
  const roads = [...main, ...driveways];
  const network = measure('network', () => {
    const registry = roadRegistry(roads);
    return roadNetwork(
      roads,
      constructedContacts(registry, frameEnds(main), driveways, plan.roadWidth / 2),
    );
  });
  return { sections, nodes, ports, roads, roadWidth: plan.roadWidth, drivewayWidth, ...network };
}
