import { validateSequence } from './sequence-checks.js';
import type { Scene, PlacedSection, PlacedNode, RoutedWire } from '../../contract/records/scene.js';
import { box, point } from '../../contract/records/camera.js';
import { PROJECTION_CAPACITY } from '../../contract/records/limits.js';
import { parse, reject } from '../validation/outcomes.js';
/** A namespace cannot contain duplicate IDs; parent and endpoint references would otherwise be ambiguous. */
function unique(
  ids: readonly string[],
  path: string,
): void {
  if (new Set(ids).size !== ids.length) reject('invalid-scene', path, 'Duplicate scene identity');
}
/** Recursive parent traversal proves acyclicity within the admitted scene capacity. */
function validateAncestors(
  node: PlacedNode,
  nodes: readonly PlacedNode[],
): void {
  validateParent(node, nodes, []);
}
/** Resolve an immutable bounded parent path; malformed chains retain the caller's prior scene. */
function validateParent(
  node: PlacedNode,
  nodes: readonly PlacedNode[],
  visited: readonly string[],
): void {
  if (node.parent === null) return;
  requireUnvisited(node.id, visited);
  const parent = requiredParent(node.parent, nodes);
  validateParent(parent, nodes, [...visited, node.id]);
}
/** Reject a repeated ancestor identity without mutating traversal state. */
function requireUnvisited(
  id: string,
  visited: readonly string[],
): void {
  if (visited.includes(id)) reject('invalid-scene', id, 'Cyclic parent chain');
}
/** Resolve one parent in the admitted section without accepting a foreign node. */
function requiredParent(
  id: string,
  nodes: readonly PlacedNode[],
): PlacedNode {
  const parent = nodes.find((candidate) => candidate.id === id);
  if (!parent) return reject('invalid-scene', id, 'Unknown parent node');
  return parent;
}
/** Layout owns feasibility; Canvas still rejects nonfinite rendering geometry and cross-section nodes. */
function validateNode(
  node: PlacedNode,
  section: PlacedSection,
): void {
  parse(box, node.box);
  if (node.sectionId !== section.id)
    reject('invalid-scene', node.id, 'Node belongs to another section');
  validateAncestors(node, section.nodes);
}
/** Member addresses must identify an actual measured anchor on the attached node. */
function validateMember(
  member: string | null,
  node: PlacedNode,
): void {
  if (member === null) return;
  if (!node.measured.content.anchors.some((anchor) => anchor.member === member))
    reject('invalid-scene', member, 'Unknown endpoint member');
}
/** Section-scoped endpoint resolution cannot accidentally join a node in another diagram. */
function validateEndpoint(
  endpoint: RoutedWire['source'],
  section: PlacedSection,
): void {
  const node = section.nodes.find((candidate) => candidate.id === endpoint.node);
  if (!node) reject('invalid-scene', endpoint.node, 'Unknown wire endpoint');
  parse(point, endpoint.point);
  validateMember(endpoint.member, node);
}
/** Route point counts are bounded independently of the rendering adapter. */
function validateWire(
  wire: RoutedWire,
  section: PlacedSection,
): void {
  if (wire.points.length < 2 || wire.points.length > 10000)
    reject('invalid-scene', wire.id, 'Route needs2..10000points');
  wire.points.forEach((value) => parse(point, value));
  validateWireLabel(wire);
  validateEndpoint(wire.source, section);
  validateEndpoint(wire.target, section);
}
/** Hidden annotations have an explicit empty footprint; visible annotations still need positive bounds. */
export function validateWireLabel(wire: RoutedWire): void {
  if (wire.labelVisible !== false) {
    parse(box, wire.labelBox);
    return;
  }
  parse(point, { x: wire.labelBox.x, y: wire.labelBox.y });
  if (wire.labelBox.width !== 0 || wire.labelBox.height !== 0)
    reject('invalid-scene', wire.id, 'Hidden wire labels must have empty bounds');
}
/** Admission checks namespace/geometry only; supplied measured notation is validated by its owning port. */
function validateSection(section: PlacedSection): void {
  parse(point, section.origin);
  parse(box, section.box);
  parse(box, section.title.box);
  unique(
    section.nodes.map((node) => node.id),
    section.id,
  );
  unique(
    section.wires.map((wire) => wire.id),
    section.id,
  );
  unique(
    [...section.sequence.events, ...section.sequence.fragments].map((item) => item.id),
    section.id,
  );
  section.nodes.forEach((node) => validateNode(node, section));
  section.wires.forEach((wire) => validateWire(wire, section));
  validateSequence(section);
}
/** Reject malformed/oversized scene before creating indexes; public open/receive retains prior state on failure. */
export function validateScene(scene: Scene): void {
  validateSectionCount(scene.sections.length);
  const nodes = scene.sections.reduce((total, section) => total + section.nodes.length, 0);
  const wires = scene.sections.reduce((total, section) => total + section.wires.length, 0);
  validateLimits(nodes, wires);
  parse(box, scene.bounds);
  unique(
    scene.sections.map((section) => section.id),
    'sections',
  );
  scene.sections.forEach(validateSection);
}
/** Section admission follows Presentation's owner limit while preserving Canvas's typed recovery path. */
function validateSectionCount(sections: number): void {
  if (sections > PROJECTION_CAPACITY.maxSections)
    reject(
      'invalid-scene',
      'sections',
      `At most${PROJECTION_CAPACITY.maxSections}sections are supported`,
    );
}
/** Global limits apply across all sections; splitting a graph never bypasses the admission bound. */
function validateLimits(
  nodes: number,
  wires: number,
): void {
  if (nodes > PROJECTION_CAPACITY.maxNodes)
    reject(
      'invalid-scene',
      'nodes',
      `At most${PROJECTION_CAPACITY.maxNodes}placed nodes are supported`,
    );
  if (wires > PROJECTION_CAPACITY.maxWires)
    reject('invalid-scene', 'wires', `At most${PROJECTION_CAPACITY.maxWires}wires are supported`);
}
