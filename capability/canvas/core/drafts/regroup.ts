import type { SessionState } from '../../contract/records/state.js';
import type { GeometryEntry, PlacementDraft } from '../../contract/records/draft.js';
import type { RegroupIntent } from '../../contract/records/intent.js';
import type { TargetInfo } from '../../contract/records/scene.js';
import type { Box, Point } from '../../contract/records/camera.js';
import { targetKey } from '../scenes/address.js';

function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
function contains(
  box: Box,
  point: Point,
): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}
function isGroup(
  state: SessionState,
  key: string,
): boolean {
  return typeof state.index.nodes[key]?.measured.groupId === 'string';
}
function section(info: TargetInfo): string | null {
  return info.target.kind === 'node' ? info.target.section : null;
}
/** True when `key` is `root` or sits anywhere inside it. */
function within(
  state: SessionState,
  key: string | null,
  root: string,
): boolean {
  if (key === null) return false;
  return key === root || within(state, state.index.targets[key]?.parentKey ?? null, root);
}
/** Smallest group under the point in the node's section; never the node itself or its own children. */
function groupAt(
  state: SessionState,
  node: TargetInfo,
  point: Point,
): TargetInfo | undefined {
  return Object.values(state.index.targets)
    .filter(
      (item) =>
        section(item) === section(node) &&
        isGroup(state, item.key) &&
        contains(item.box, point) &&
        !within(state, item.key, node.key),
    )
    .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
}
/** A single moved node (not a group); multi-select and resize keep the plain placement path. */
function soleNode(draft: PlacementDraft): GeometryEntry | undefined {
  if (draft.kind !== 'move' || draft.current.length !== 1) return undefined;
  return draft.current.find((entry) => entry.target.kind === 'node');
}
/** The container the node was dropped in, when it differs from its current one. */
function destination(
  state: SessionState,
  entry: GeometryEntry,
): TargetInfo | null {
  const node = state.index.targets[targetKey(entry.target)];
  if (node === undefined || isGroup(state, node.key)) return null;
  const into =
    groupAt(state, node, centre(entry.box)) ??
    state.index.targets[targetKey({ kind: 'section', id: section(node) ?? '' })];
  return into === undefined || into.key === node.parentKey ? null : into;
}
/** Children of a group are placed from its top-left; top-level nodes from the section origin. */
function origin(into: TargetInfo): Point {
  return into.target.kind === 'section' ? into.sectionOrigin : into.box;
}
/** Dropping one node into another group (or out of every group) changes its group, not just its position. */
export function regroupIntent(
  state: SessionState,
  draft: PlacementDraft,
): RegroupIntent | null {
  const entry = soleNode(draft);
  const into = entry === undefined ? null : destination(state, entry);
  if (entry === undefined || into === null) return null;
  const from = origin(into);
  return {
    kind: 'regroup',
    id: draft.id,
    base: draft.base,
    scope: 'appearance',
    target: entry.target,
    into: into.target,
    placement: { x: entry.box.x - from.x, y: entry.box.y - from.y, locked: entry.locked },
  };
}
