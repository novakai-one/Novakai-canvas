import type { SessionState } from '../../contract/records/state.js';
import type { PlacedSection } from '../../contract/records/scene.js';
import type { Target } from '../../contract/records/selection.js';
import { targetKey } from './address.js';

/** A folder is semantic parentage, independent of section/group containment. */
export function treeFolder(
  state: SessionState,
  target: Target,
): boolean {
  if (target.kind !== 'node') return false;
  const section = state.scene.sections.find((item) => item.id === target.section);
  return section?.tree?.edges.some((edge) => edge.source === target.id) ?? false;
}
/** Folding never writes geometry or changes the space allocated to any diagram. */
export function foldedTreeAncestor(
  state: SessionState,
  section: PlacedSection,
  id: string,
): boolean {
  if (!state.treeCollapsed?.length) return false;
  const parents = new Map(section.tree?.edges.map((edge) => [edge.target, edge.source]));
  return hiddenParent(state, section.id, parents.get(id), parents);
}
function hiddenParent(
  state: SessionState,
  section: string,
  parent: string | undefined,
  parents: ReadonlyMap<string, string>,
): boolean {
  if (parent === undefined) return false;
  const key = targetKey({ kind: 'node', section, id: parent });
  return (
    (state.treeCollapsed?.includes(key) ?? false) ||
    hiddenParent(state, section, parents.get(parent), parents)
  );
}

/** Tree rows are positioned together; moving the containing section remains available. */
export function treeNode(
  state: SessionState,
  target: Target,
): boolean {
  if (target.kind !== 'node') return false;
  const section = state.scene.sections.find((item) => item.id === target.section);
  return section?.tree?.rows.some((row) => row.node === target.id) ?? false;
}
