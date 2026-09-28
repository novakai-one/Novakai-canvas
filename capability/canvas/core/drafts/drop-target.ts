import type { SessionState } from '../../contract/records/state.js';
import type { DropTarget } from '../../contract/records/intent.js';
import type { TargetInfo } from '../../contract/records/scene.js';
import type { Box, Point } from '../../contract/records/camera.js';

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
function groupId(
  state: SessionState,
  info: TargetInfo,
): string | null {
  const id = state.index.nodes[info.key]?.measured.groupId;
  return typeof id === 'string' ? id : null;
}
function smallest(items: readonly TargetInfo[]): TargetInfo | undefined {
  return [...items].sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
}
/** The group frame under the point. When several frames contain it, the smallest wins. */
function groupAt(
  state: SessionState,
  point: Point,
): TargetInfo | undefined {
  const infos = Object.values(state.index.targets);
  return smallest(
    infos.filter((info) => groupId(state, info) !== null && contains(info.box, point)),
  );
}
function sectionAt(
  state: SessionState,
  point: Point,
): TargetInfo | undefined {
  const infos = Object.values(state.index.targets);
  return infos.find((info) => info.target.kind === 'section' && contains(info.box, point));
}
function fromGroup(
  state: SessionState,
  info: TargetInfo,
): DropTarget | null {
  if (info.target.kind !== 'node') return null;
  return { section: info.target.section, group: groupId(state, info) };
}
function fromSection(info: TargetInfo | undefined): DropTarget | null {
  if (info?.target.kind !== 'section') return null;
  return { section: info.target.id, group: null };
}
/** Where a new object dropped at a world point belongs: the innermost group, else the section. */
export function dropTarget(
  state: SessionState,
  point: Point,
): DropTarget | null {
  const group = groupAt(state, point);
  if (group !== undefined) return fromGroup(state, group);
  return fromSection(sectionAt(state, point));
}
