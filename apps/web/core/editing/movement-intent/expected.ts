/*
 * Where every scene box should land after a move: each moved root's shift, applied to the root,
 * its subtree and, for a moved section, every node in it; all node boxes in world coordinates.
 * Pure; Authoring owns commit and recovery.
 */
import type { NodeTarget, RenderDocument, Target } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import { failure } from '../../../contract/errors.js';
import { targetKey, type Box } from '../capture/boxes.js';
import { parentNode, type SceneNode, type SceneSection } from '../capture/scene.js';
import { mapResults } from '../results.js';
import { capturedNode } from './selection.js';
import type { CapturedNode, PlacementEntry } from './types.js';

/** How far a moved root travels, in world units. */
type Shift = { readonly dx: number; readonly dy: number };

/** A section target. */
type SectionTarget = Extract<Target, { kind: 'section' }>;

/** A requested placement, local to the target's parent (or section). */
type LocalPlacement = PlacementEntry['placement'];

/**
 * Every scene section and node box, keyed by target, as it should be after the move: section by
 * section in scene order, each section before its nodes. A node takes the shift of the nearest
 * moved root at or above it, else its section's; unmoved section boxes are returned as they are.
 * A target listed twice keeps its last placement. Refusals, first failing entry wins:
 * `unsupported-edit` — a wire or sequence target; `stale-target` — a section, node or node
 * parent missing from the scene.
 */
export function expectedBoxes(
  document: RenderDocument,
  entries: readonly PlacementEntry[],
): Result<ReadonlyMap<string, Box>> {
  const roots = rootShifts(document, entries);
  if (!roots.ok) return roots;
  const boxes = document.scene.sections.flatMap((section) => sectionBoxes(section, roots.value));
  return { ok: true, value: new Map(boxes) };
}

/** Each moved root's shift, keyed by target; a repeated target keeps its last shift. */
function rootShifts(
  document: RenderDocument,
  entries: readonly PlacementEntry[],
): Result<ReadonlyMap<string, Shift>> {
  const shifts = mapResults(entries, (entry) => keyedShift(document, entry));
  if (!shifts.ok) return shifts;
  return { ok: true, value: new Map(shifts.value) };
}

/** One entry's shift, paired with its target key. */
function keyedShift(
  document: RenderDocument,
  entry: PlacementEntry,
): Result<readonly [string, Shift]> {
  const shift = expectedShift(document, entry.target, entry.placement);
  if (!shift.ok) return shift;
  return { ok: true, value: [targetKey(entry.target), shift.value] };
}

/** A section or node root's shift; any other target kind is `unsupported-edit`. */
function expectedShift(
  document: RenderDocument,
  target: Target,
  placement: LocalPlacement,
): Result<Shift> {
  if (target.kind === 'section') return sectionShift(document, target, placement);
  if (target.kind === 'node') return nodeShift(document, target, placement);
  return failure('unsupported-edit', 'Movement review supports module nodes and sections');
}

/** A section's placement is its new origin; a section missing from the scene is `stale-target`. */
function sectionShift(
  document: RenderDocument,
  target: SectionTarget,
  placement: LocalPlacement,
): Result<Shift> {
  const section = document.scene.sections.find((item) => item.id === target.id);
  if (section === undefined) return failure('stale-target', 'The selected section is missing');
  return {
    ok: true,
    value: { dx: placement.x - section.origin.x, dy: placement.y - section.origin.y },
  };
}

/** A node's shift, once the node is found in the scene. */
function nodeShift(
  document: RenderDocument,
  target: NodeTarget,
  placement: LocalPlacement,
): Result<Shift> {
  const captured = capturedNode(document, target);
  if (!captured.ok) return captured;
  return shiftWithinParent(captured.value, placement);
}

/**
 * The placement is local to the node's parent (or its section at the root). Kept unsimplified:
 * cancelling the section origin by hand changes floating-point results.
 */
function shiftWithinParent(
  { section, node }: CapturedNode,
  placement: LocalPlacement,
): Result<Shift> {
  const parent = capturedParent(section, node);
  if (!parent.ok) return parent;
  return {
    ok: true,
    value: {
      dx:
        section.origin.x +
        (parent.value?.box.x ?? 0) +
        placement.x -
        (node.box.x + section.origin.x),
      dy:
        section.origin.y +
        (parent.value?.box.y ?? 0) +
        placement.y -
        (node.box.y + section.origin.y),
    },
  };
}

/** The node's parent, or none at the root; a named parent missing from the scene is `stale-target`. */
function capturedParent(
  section: SceneSection,
  node: SceneNode,
): Result<SceneNode | undefined> {
  const parent = parentNode(section, node);
  if (parent === undefined && node.parent !== null)
    return failure('stale-target', 'The selected node parent is missing');
  return { ok: true, value: parent };
}

/** The section's own box, then each of its nodes' boxes, in scene order. */
function sectionBoxes(
  section: SceneSection,
  roots: ReadonlyMap<string, Shift>,
): readonly (readonly [string, Box])[] {
  const key = targetKey({ kind: 'section', id: section.id });
  const sectionShift = roots.get(key);
  return [
    [key, shiftedSectionBox(section.box, sectionShift)],
    ...section.nodes.map((node) => nodeBox(section, node, roots, sectionShift)),
  ];
}

/** An unmoved section keeps its box object; a moved one is copied and shifted. */
function shiftedSectionBox(
  box: Box,
  shift: Shift | undefined,
): Box {
  return shift === undefined ? box : { ...box, x: box.x + shift.dx, y: box.y + shift.dy };
}

/** One node's world box, shifted by its nearest moved root or else its section's shift. */
function nodeBox(
  section: SceneSection,
  node: SceneNode,
  roots: ReadonlyMap<string, Shift>,
  sectionShift: Shift | undefined,
): readonly [string, Box] {
  const shift = nearestShift(section, node.id, roots) ?? sectionShift;
  return [
    targetKey({ kind: 'node', section: section.id, id: node.id }),
    worldBox(node.box, section.origin, shift),
  ];
}

/**
 * The shift of the first moved root found walking up from `id`, itself included. Parents are
 * looked up by id, and the walk ends at a missing parent; Layout rejects parent cycles.
 */
function nearestShift(
  section: SceneSection,
  id: SceneNode['parent'],
  roots: ReadonlyMap<string, Shift>,
): Shift | undefined {
  if (id === null) return undefined;
  const own = roots.get(targetKey({ kind: 'node', section: section.id, id }));
  if (own !== undefined) return own;
  const parent = section.nodes.find((item) => item.id === id)?.parent ?? null;
  return nearestShift(section, parent, roots);
}

/** A section-local box moved into world coordinates, then by the shift when there is one. */
function worldBox(
  box: Box,
  origin: SceneSection['origin'],
  shift: Shift | undefined,
): Box {
  return shift === undefined
    ? { ...box, x: box.x + origin.x, y: box.y + origin.y }
    : { ...box, x: box.x + origin.x + shift.dx, y: box.y + origin.y + shift.dy };
}
