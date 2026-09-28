/*
 * The movements the canvas allows: a grown container, a pushed sibling, a stopped-short drop,
 * a refitted section. Each rule is a pure predicate over the captured and preview boxes.
 */
import type { RenderDocument, Target } from '../../../contract/records/owners.js';
import { sceneBox, targetKey, type Box } from '../capture/boxes.js';
import { between, near, sameSize } from './measure.js';
import type { GeometryPreview, PreviewBox } from './types.js';

/** The box moved by a rule the canvas allows. */
export function matchesAllowedMovement(
  document: RenderDocument,
  item: PreviewBox,
  expected: Box,
  preview: GeometryPreview,
): boolean {
  return (
    grewToHold(document, item.target, expected, item.box) ||
    pushedAside(document, item.target, expected, item.box, preview) ||
    stoppedShort(document, item.target, expected, item.box) ||
    refitted(item.target, expected, item.box)
  );
}

/** A section fits its content, so it may shrink or grow when a child moves; it never drifts. */
function refitted(
  target: Target,
  expected: Box,
  actual: Box,
): boolean {
  return target.kind === 'section' && near(actual.x, expected.x) && near(actual.y, expected.y);
}

/** A group or section may grow to hold a moved child; it never shrinks or drifts away. */
function grewToHold(
  document: RenderDocument,
  target: Target,
  expected: Box,
  actual: Box,
): boolean {
  return isContainerTarget(document, target) && holdsExpected(expected, actual);
}

/** A section, or a node inside a group, may grow to hold a moved child. */
function isContainerTarget(
  document: RenderDocument,
  target: Target,
): boolean {
  if (target.kind === 'section') return true;
  if (target.kind !== 'node') return false;
  return nodeGroupId(document, target) != null;
}

/** The group of a node target, when it sits in one. */
function nodeGroupId(
  document: RenderDocument,
  target: Extract<Target, { kind: 'node' }>,
) {
  return document.scene.sections
    .find((section) => section.id === target.section)
    ?.nodes.find((node) => node.id === target.id)?.measured.groupId;
}

/** The actual box covers the expected box, growing up and left at most. */
function holdsExpected(
  expected: Box,
  actual: Box,
): boolean {
  return (
    actual.x <= expected.x &&
    actual.y <= expected.y &&
    actual.x + actual.width >= expected.x + expected.width &&
    actual.y + actual.height >= expected.y + expected.height
  );
}

/** A grown section or group pushes a later sibling right or down; the pushed container keeps its
 * size and its contents travel with it. */
function pushedAside(
  document: RenderDocument,
  target: Target,
  expected: Box,
  actual: Box,
  preview: GeometryPreview,
): boolean {
  const sectionId = sectionOf(target);
  if (sectionId === null) return false;
  return containerChain(document, target, sectionId).some((container) =>
    pushedContainer(document, preview, container, expected, actual),
  );
}

/** The section a target belongs to. */
function sectionOf(target: Target): string | null {
  if (target.kind === 'section') return target.id;
  if (target.kind === 'node') return target.section;
  return null;
}

/** The target's group chain, innermost first, ending with its section. */
function containerChain(
  document: RenderDocument,
  target: Target,
  sectionId: string,
): readonly Target[] {
  const nodes = document.scene.sections.find((section) => section.id === sectionId)?.nodes ?? [];
  const groups = ancestorNodes(nodes, target).filter((node) => node.measured.groupId != null);
  const groupTargets = groups.map((node) => ({
    kind: 'node' as const,
    section: sectionId,
    id: node.id,
  }));
  return [...groupTargets, { kind: 'section', id: sectionId }];
}

/** The chain of nodes from the target up to the root. */
function ancestorNodes(
  nodes: readonly RenderDocument['scene']['sections'][number]['nodes'][number][],
  target: Target,
) {
  const first = target.kind === 'node' ? nodes.find((item) => item.id === target.id) : undefined;
  if (first === undefined) return [];
  return [first, ...ancestorsOf(nodes, first)];
}

/** The node's ancestors, nearest first. */
function ancestorsOf(
  nodes: readonly RenderDocument['scene']['sections'][number]['nodes'][number][],
  node: RenderDocument['scene']['sections'][number]['nodes'][number],
): readonly RenderDocument['scene']['sections'][number]['nodes'][number][] {
  const parent = node.parent === null ? undefined : nodes.find((item) => item.id === node.parent);
  if (parent === undefined) return [];
  return [parent, ...ancestorsOf(nodes, parent)];
}

/** A container was pushed right or down by an earlier sibling's growth, keeping its size. */
function pushedContainer(
  document: RenderDocument,
  preview: GeometryPreview,
  container: Target,
  expected: Box,
  actual: Box,
): boolean {
  const before = sceneBox(document, container);
  const after = preview.boxes.find((item) => targetKey(item.target) === targetKey(container))?.box;
  if (before === undefined || after === undefined) return false;
  return pushedGeometry(document, preview, container, before, after, expected, actual);
}

/** The container moved by the sibling's growth and matches the expected box after that move. */
function pushedGeometry(
  document: RenderDocument,
  preview: GeometryPreview,
  container: Target,
  before: Box,
  after: Box,
  expected: Box,
  actual: Box,
): boolean {
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  return (
    pushedRightOrDown(dx, dy) &&
    sameSize(before, after) &&
    earlierSiblingGrew(document, preview, container, before, dx, dy) &&
    movedExactly(expected, actual, dx, dy)
  );
}

/** Pushed strictly right or down, and actually moved. */
function pushedRightOrDown(
  dx: number,
  dy: number,
): boolean {
  const moved = !near(dx, 0) || !near(dy, 0);
  return moved && dx >= -0.01 && dy >= -0.01;
}

/** The box moved by exactly dx, dy, keeping its size. */
function movedExactly(
  expected: Box,
  actual: Box,
  dx: number,
  dy: number,
): boolean {
  return (
    near(expected.x + dx, actual.x) && near(expected.y + dy, actual.y) && sameSize(expected, actual)
  );
}

/** Something before the pushed container, beside or above it, got bigger. */
function earlierSiblingGrew(
  document: RenderDocument,
  preview: GeometryPreview,
  pushed: Target,
  at: Box,
  dx: number,
  dy: number,
): boolean {
  return preview.boxes.some((item) => siblingGrewBefore(document, item, pushed, at, dx, dy));
}

/** One earlier sibling of the same kind grew before the pushed container. */
function siblingGrewBefore(
  document: RenderDocument,
  item: PreviewBox,
  pushed: Target,
  at: Box,
  dx: number,
  dy: number,
): boolean {
  if (!isOtherSibling(item, pushed)) return false;
  const was = sceneBox(document, item.target);
  return was !== undefined && grewBefore(item.box, was, at, dx, dy);
}

/** The same kind of target, but not the pushed one. */
function isOtherSibling(
  item: PreviewBox,
  pushed: Target,
): boolean {
  return item.target.kind === pushed.kind && targetKey(item.target) !== targetKey(pushed);
}

/** The sibling grew, and it sat beside or above the pushed container. */
function grewBefore(
  box: Box,
  was: Box,
  at: Box,
  dx: number,
  dy: number,
): boolean {
  return grewBy(box, was) && satBefore(was, at, dx, dy);
}

/** The box grew in width or height. */
function grewBy(
  box: Box,
  was: Box,
): boolean {
  return box.width > was.width + 0.01 || box.height > was.height + 0.01;
}

/** The box sat beside the pushed container (when pushed right) or above it (when pushed down). */
function satBefore(
  was: Box,
  at: Box,
  dx: number,
  dy: number,
): boolean {
  return (
    (dx > 0.01 && was.x + was.width <= at.x + 0.01) ||
    (dy > 0.01 && was.y + was.height <= at.y + 0.01)
  );
}

/** A dragged node may stop at its group's inset, between where it was and where it was dropped. */
function stoppedShort(
  document: RenderDocument,
  target: Target,
  expected: Box,
  actual: Box,
): boolean {
  if (target.kind !== 'node') return false;
  return stoppedBetween(sceneBox(document, target), expected, actual);
}

/** The node kept its size and sits between its captured and requested positions. */
function stoppedBetween(
  before: Box | undefined,
  expected: Box,
  actual: Box,
): boolean {
  if (before === undefined) return false;
  return sameSize(expected, actual) && betweenBoxes(before, expected, actual);
}

/** Both coordinates of the actual box sit between the captured and requested ones. */
function betweenBoxes(
  before: Box,
  expected: Box,
  actual: Box,
): boolean {
  return between(before.x, expected.x, actual.x) && between(before.y, expected.y, actual.y);
}
