import type {
  Scene,
  SceneIndex,
  TargetInfo,
  PlacedSection,
  PlacedNode,
} from '../../contract/records/scene.js';
import type { Target } from '../../contract/records/selection.js';
import type { Point } from '../../contract/records/camera.js';
import { translateBox } from '../camera/coordinates.js';
import { targetKey } from './address.js';
/** Section targets occupy world coordinates while title and children remain section-local. */
function sectionInfo(section: PlacedSection): TargetInfo {
  const target: Target = { kind: 'section', id: section.id };
  return {
    target,
    key: targetKey(target),
    label: section.title.content.outline.join(' '),
    box: section.box,
    parentKey: null,
    parentOrigin: { x: section.box.x - section.origin.x, y: section.box.y - section.origin.y },
    sectionOrigin: section.origin,
    minimum: { width: section.box.width, height: section.box.height },
    locked: false,
  };
}
/** Section origin plus measured parent origin defines the only parent-local conversion. */
function parentOrigin(
  node: PlacedNode,
  section: PlacedSection,
): Point {
  const parent = section.nodes.find((candidate) => candidate.id === node.parent);
  if (!parent) return section.origin;
  return { x: section.origin.x + parent.box.x, y: section.origin.y + parent.box.y };
}
/** Explicit parent target keeps generated scene identities opaque. */
function parentTarget(
  node: PlacedNode,
  section: PlacedSection,
): Target {
  if (node.parent === null) return { kind: 'section', id: section.id };
  return { kind: 'node', section: section.id, id: node.parent };
}
/** Node index carries measured minima for resize and canonical labels for accessibility. */
function nodeInfo(
  node: PlacedNode,
  section: PlacedSection,
): TargetInfo {
  const target: Target = { kind: 'node', section: section.id, id: node.id };
  return {
    target,
    key: targetKey(target),
    label: node.measured.label,
    box: translateBox(node.box, section.origin),
    parentKey: targetKey(parentTarget(node, section)),
    parentOrigin: parentOrigin(node, section),
    sectionOrigin: section.origin,
    minimum: { width: node.measured.width, height: node.measured.height },
    locked: node.measured.placement?.locked ?? false,
  };
}
/** Wires and sequence items use measured label bounds for explicit navigation and selection. */
function labelledInfo(
  target: Target,
  label: string,
  bounds: TargetInfo['box'],
  section: PlacedSection,
): TargetInfo {
  return {
    target,
    key: targetKey(target),
    label,
    box: translateBox(bounds, section.origin),
    parentKey: targetKey({ kind: 'section', id: section.id }),
    parentOrigin: section.origin,
    sectionOrigin: section.origin,
    minimum: { width: bounds.width, height: bounds.height },
    locked: false,
  };
}
/** Each section owns its ordered addresses; sequence events and fragments remain separate from nodes/wires. */
function sectionTargets(section: PlacedSection): readonly TargetInfo[] {
  const nodes = section.nodes.map((node) => nodeInfo(node, section));
  const wires = section.wires.map((wire) =>
    labelledInfo(
      { kind: 'wire', section: section.id, id: wire.id },
      wire.measuredLabel.outline.join(' '),
      wire.labelBox,
      section,
    ),
  );
  const events = section.sequence.events.map((event) =>
    labelledInfo(
      { kind: 'sequence', section: section.id, id: event.id },
      event.content.outline.join(' '),
      event.labelBox,
      section,
    ),
  );
  const fragments = section.sequence.fragments.map((frame) =>
    labelledInfo(
      { kind: 'sequence', section: section.id, id: frame.id },
      frame.content.outline.join(' '),
      frame.box,
      section,
    ),
  );
  return [sectionInfo(section), ...nodes, ...wires, ...events, ...fragments];
}
/** Index once per admitted scene; records are immutable and ID lookup does not require graph scans during dragging. */
export function indexScene(scene: Scene): SceneIndex {
  const infos = scene.sections.flatMap(sectionTargets);
  return Object.freeze({
    targets: Object.freeze(
      Object.fromEntries(infos.map((info) => [info.key, Object.freeze(info)])),
    ),
    order: Object.freeze(infos.map((info) => info.key)),
    nodes: Object.freeze(
      Object.fromEntries(
        scene.sections.flatMap((section) =>
          section.nodes.map((node) => [
            targetKey({ kind: 'node', section: section.id, id: node.id }),
            node,
          ]),
        ),
      ),
    ),
    wires: Object.freeze(
      Object.fromEntries(
        scene.sections.flatMap((section) =>
          section.wires.map((wire) => [
            targetKey({ kind: 'wire', section: section.id, id: wire.id }),
            wire,
          ]),
        ),
      ),
    ),
    sections: Object.freeze(
      Object.fromEntries(scene.sections.map((section) => [section.id, section])),
    ),
  });
}
