import { axes } from './prototype-road-geometry.js';
import type { PrototypePortLocation, PrototypeBlock } from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import { required } from './nested-support-graph.js';
import { readPrototypeNodePorts } from './prototype-road-nodes.js';

function sectionBounds(
  id: string,
  values: ReadonlyMap<string, number>,
) {
  const x = required(values, `${id}:x:low`),
    y = required(values, `${id}:y:low`);
  return {
    x,
    y,
    width: required(values, `${id}:x:high`) - x,
    height: required(values, `${id}:y:high`) - y,
  };
}
function gate(
  port: PrototypePortLocation,
  values: ReadonlyMap<string, number>,
): PrototypePortLocation {
  const vertical = ['top', 'bottom'].includes(port.side);
  const { along, across } = axes[vertical ? 'vertical' : 'horizontal'];
  const side = ['top', 'left'].includes(port.side) ? 'low' : 'high';
  return {
    ...port,
    point: {
      ...port.point,
      [along]: required(values, `${port.sectionId}:${along}:${side}`),
      [across]: required(values, `${port.portId}:center`),
    },
  };
}
function sectionPorts(
  section: PrototypeBlock,
  ports: ReadonlyMap<string, PrototypePortLocation>,
) {
  return (section.ports ?? []).map((port) => {
    const point = required(ports, port.id).point;
    return { ...port, offset: { x: point.x - section.bounds.x, y: point.y - section.bounds.y } };
  });
}

/** Translate rigid nodes and materialize section walls/gate offsets from solved construction lines.
 * Pure copies preserve semantic order; reconstruction is the recovery path.
 */
export function embedNestedBodies(
  scene: RoadPrototypeScene,
  values: ReadonlyMap<string, number>,
) {
  const nodes = scene.nodes.map((node) => ({
    ...node,
    bounds: {
      ...node.bounds,
      x: required(values, `${node.id}:x:center`) - node.bounds.width / 2,
      y: required(values, `${node.id}:y:center`) - node.bounds.height / 2,
    },
  }));
  const nodePorts = new Map(
    nodes.flatMap(readPrototypeNodePorts).map((port) => [port.portId, port]),
  );
  const ports = scene.ports.map((port) =>
    port.nodeId === port.sectionId ? gate(port, values) : required(nodePorts, port.portId),
  );
  const byPort = new Map(ports.map((port) => [port.portId, port]));
  const sections = scene.sections.map((section) => {
    const moved = { ...section, bounds: sectionBounds(section.id, values) };
    return { ...moved, ports: sectionPorts(moved, byPort) };
  });
  return { nodes, sections, ports };
}
