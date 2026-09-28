/*
 * Geometry and identity helpers for captured movement: a target's scene box, stable target keys,
 * exact box comparison and the subtree closure of a dragged node. Pure; Authoring owns commit and
 * recovery.
 */
import type { PlacementIntent, RenderDocument, Target } from '../../../contract/records/owners.js';
import type { GeometryChange } from '../../../contract/records/movement.js';

/** A measured rectangle: x, y, width and height. */
export type Box = GeometryChange['before'];

/** The scene box of a target, when it names a section or node with one. */
export function sceneBox(
  document: RenderDocument,
  target: Target,
): Box | undefined {
  if (target.kind === 'section') return sectionBox(document, target.id);
  if (target.kind === 'node') return nodeWorldBox(document, target);
  return undefined;
}

/** A stable key for a movement target. */
export function targetKey(target: Target): string {
  if (target.kind === 'section') return `section:${target.id}`;
  return `node:${target.section}:${target.id}`;
}

/** Two boxes match exactly, dimension by dimension. */
export function exactBox(
  before: Box,
  after: Box,
): boolean {
  return boxDimensions(before).every((value, index) => value === boxDimensions(after)[index]);
}

/** The target keys of a dragged node's whole subtree, the node included. */
export function closureKeys(
  document: RenderDocument,
  entry: PlacementIntent['entries'][number],
): ReadonlySet<string> {
  if (entry.target.kind !== 'node') return new Set();
  return nodeClosure(document, entry.target.section, entry.target.id);
}

/** A section's own scene box. */
function sectionBox(
  document: RenderDocument,
  id: string,
): Box | undefined {
  return document.scene.sections.find((section) => section.id === id)?.box;
}

/** A node's box in world coordinates: its box offset by its section's origin. */
function nodeWorldBox(
  document: RenderDocument,
  target: Extract<Target, { kind: 'node' }>,
): Box | undefined {
  const section = document.scene.sections.find((item) => item.id === target.section);
  const node = section?.nodes.find((item) => item.id === target.id);
  if (section === undefined || node === undefined) return undefined;
  return { ...node.box, x: node.box.x + section.origin.x, y: node.box.y + section.origin.y };
}

/** A box as its four dimensions, in order. */
function boxDimensions(box: Box): readonly number[] {
  return [box.x, box.y, box.width, box.height];
}

/** The keys of every node inside the named node's subtree, itself included. */
function nodeClosure(
  document: RenderDocument,
  sectionId: string,
  nodeId: string,
): ReadonlySet<string> {
  const section = document.scene.sections.find((item) => item.id === sectionId);
  if (section === undefined) return new Set();
  const inside = section.nodes.filter((node) => containsAncestor(section.nodes, node.id, nodeId));
  return new Set(
    inside.map((node) => targetKey({ kind: 'node', section: section.id, id: node.id })),
  );
}

/** Whether walking up from `start` reaches `wanted`. Loops end at a missing parent. */
function containsAncestor(
  nodes: readonly { readonly id: string; readonly parent: string | null }[],
  start: string,
  wanted: string,
): boolean {
  let current: string | null = start;
  while (current !== null && current !== wanted)
    current = nodes.find((item) => item.id === current)?.parent ?? null;
  return current === wanted;
}
