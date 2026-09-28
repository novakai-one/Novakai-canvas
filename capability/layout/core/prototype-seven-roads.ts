import { roadRegistry, constructedContacts, frameEnds } from './prototype-road-registry.js';
/** Seven-node geometry experiment: rows reserve roads before node-owned ports are read. */
import type {
  PrototypeBlock,
  PrototypeRoad,
  PrototypeNode,
  PrototypePortLocation,
  PrototypeLayoutOptions,
} from '../contract/records/road-prototype.js';
import { placePrototypeNode, readPrototypeNodePorts } from './prototype-road-nodes.js';
import { roadNetwork } from './prototype-road-network.js';

const width = 48,
  half = width / 2,
  clearance = 72;
function street(
  id: string,
  sectionId: string | null,
  axis: PrototypeRoad['axis'],
  at: number,
  start: number,
  end: number,
): PrototypeRoad {
  const bounds =
    axis === 'horizontal'
      ? { x: start - half, y: at - half, width: end - start + width, height: width }
      : { x: at - half, y: start - half, width, height: end - start + width };
  return {
    id,
    sectionId,
    axis,
    kind: 'street',
    access: null,
    directions: axis === 'horizontal' ? ['left', 'right'] : ['down', 'up'],
    bounds,
  };
}
function section(
  index: number,
  x: number,
  width: number,
  rows: number,
  portShift = 0,
): PrototypeBlock {
  const bounds = { x, y: 160, width, height: 208 + rows * 240 };
  return {
    id: `section-${index}`,
    label: `Section ${index}`,
    bounds,
    ports: [
      {
        id: `section-${index}:entry-top`,
        side: 'top',
        role: 'entry',
        offset: { x: width / 2 + portShift, y: 0 },
      },
      {
        id: `section-${index}:entry-left`,
        side: 'left',
        role: 'entry',
        offset: { x: 0, y: bounds.height / 2 },
      },
      {
        id: `section-${index}:exit-bottom`,
        side: 'bottom',
        role: 'exit',
        offset: { x: width / 2 + portShift, y: bounds.height },
      },
      {
        id: `section-${index}:exit-right`,
        side: 'right',
        role: 'exit',
        offset: { x: width, y: bounds.height / 2 },
      },
    ],
  };
}
function boundsFor(node: PrototypeNode) {
  return {
    left: node.bounds.x - clearance,
    right: node.bounds.x + node.bounds.width + clearance,
    top: node.bounds.y - clearance,
    bottom: node.bounds.y + node.bounds.height + clearance,
  };
}
function localRoads(
  section: PrototypeBlock,
  nodes: readonly PrototypeNode[],
): PrototypeRoad[] {
  const left = section.bounds.x + 64,
    right = section.bounds.x + section.bounds.width - 64;
  const levels = [
    ...new Set(nodes.flatMap((n) => [boundsFor(n).top, boundsFor(n).bottom])),
  ].toSorted((a, b) => a - b);
  const top = levels[0] ?? 0,
    bottom = levels.at(-1) ?? 0;
  const roads = [
    ...levels.map((y) => street(`${section.id}:h:${y}`, section.id, 'horizontal', y, left, right)),
    ...[left, right].map((x) =>
      street(`${section.id}:perimeter:${x}`, section.id, 'vertical', x, top, bottom),
    ),
  ];
  return [
    ...new Map([...roads, ...nodes.flatMap((n) => flanks(n))].map((r) => [r.id, r])).values(),
  ];
}
function flanks(node: PrototypeNode): PrototypeRoad[] {
  const b = boundsFor(node);
  return [b.left, b.right].map((x) =>
    street(`${node.sectionId}:v:${x}:${b.top}`, node.sectionId, 'vertical', x, b.top, b.bottom),
  );
}
function driveway(
  port: PrototypePortLocation,
  start: number,
  end: number,
): PrototypeRoad {
  const vertical = ['top', 'bottom'].includes(port.side);
  const bounds = vertical
    ? { x: port.point.x - 12, y: start, width: 24, height: end - start }
    : { x: start, y: port.point.y - 12, width: end - start, height: 24 };
  return {
    id: `drive:${port.portId}`,
    sectionId: port.sectionId,
    kind: 'driveway',
    ...driveDirection(vertical),
    bounds,
    access: { nodeId: port.nodeId, portId: port.portId, role: port.role, side: port.side },
  };
}
function nodeDrive(port: PrototypePortLocation): PrototypeRoad {
  const at = ['top', 'bottom'].includes(port.side) ? port.point.y : port.point.x;
  const starts = { top: at - 48, left: at - 48, bottom: at, right: at };
  return driveway(port, starts[port.side], starts[port.side] + 48);
}
function gate(
  port: PrototypePortLocation,
  section: PrototypeBlock,
  outside: readonly number[],
): PrototypeRoad {
  const b = section.bounds;
  const starts = {
    top: 64 + half,
    left: (outside[0] ?? 0) + half,
    bottom: b.y + b.height - 96 + half,
    right: b.x + b.width - 64 + half,
  };
  const ends = {
    top: b.y + 112 - half,
    left: b.x + 64 - half,
    bottom: 1184 - half,
    right: (outside[1] ?? 0) - half,
  };
  return driveway(port, starts[port.side], ends[port.side]);
}
function ownerPorts(section: PrototypeBlock): readonly PrototypePortLocation[] {
  return readPrototypeNodePorts({ ...section, sectionId: section.id, ports: section.ports ?? [] });
}
function externalRoads(): PrototypeRoad[] {
  return [
    ...[64, 1184].map((y) => street(`world:h:${y}`, null, 'horizontal', y, 64, 3472)),
    ...[64, 1240, 2568, 3472].map((x) => street(`world:v:${x}`, null, 'vertical', x, 64, 1184)),
  ];
}
/** Explicit fixture, separate from the earlier two-node milestone. No convergence loop or DOM reads. */
export function createSevenRoadScene(options: PrototypeLayoutOptions = {}) {
  const measure = options.measure ?? ((_stage, run) => run());
  const sections = measure('capacity', () => [
    section(1, 160, 960, 3),
    section(2, 1360, 1088, 1, 64),
    section(3, 2688, 672, 2),
  ]);
  const nodes = measure('nodes', () => [
    ...[0, 1, 2].map((i) =>
      placePrototypeNode('section-1', i, { x: 400 + i * 96, y: 344 + i * 240 }),
    ),
    ...[0, 1].map((i) => placePrototypeNode('section-2', 3 + i, { x: 1600 + i * 336, y: 344 })),
    ...[0, 1].map((i) => placePrototypeNode('section-3', 5 + i, { x: 2912, y: 344 + i * 240 })),
  ]);
  const { ports, sectionPorts } = measure('ports', () => ({
    ports: nodes.flatMap(readPrototypeNodePorts),
    sectionPorts: sections.flatMap(ownerPorts),
  }));
  const main = measure('main-roads', () => [
    ...externalRoads(),
    ...sections.flatMap((s) =>
      localRoads(
        s,
        nodes.filter((n) => n.sectionId === s.id),
      ),
    ),
  ]);
  const outer = [
    [64, 1240],
    [1240, 2568],
    [2568, 3472],
  ];
  const drives = measure('driveways', () => [
    ...ports.map(nodeDrive),
    ...sections.flatMap((s, i) =>
      sectionPorts.filter((p) => p.sectionId === s.id).map((p) => gate(p, s, outer[i] ?? [])),
    ),
  ]);
  const roads = [...main, ...drives];
  const network = measure('network', () => {
    const registry = roadRegistry(roads);
    return roadNetwork(roads, constructedContacts(registry, frameEnds(main), drives, half));
  });
  return {
    sections,
    nodes,
    ports: [...ports, ...sectionPorts],
    roads,
    roadWidth: width,
    drivewayWidth: 24,
    ...network,
  };
}

function driveDirection(vertical: boolean): Pick<PrototypeRoad, 'axis' | 'directions'> {
  if (vertical) return { axis: 'vertical', directions: ['down'] };
  return { axis: 'horizontal', directions: ['right'] };
}
