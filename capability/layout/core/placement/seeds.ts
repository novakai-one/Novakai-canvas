import type { VisualNode, VisualSection } from '../../contract/records/input.js';
import type { SectionCandidate } from '../../contract/records/candidate.js';

/** Explicit scope intent replaces automatic history, including ancestor translations; authored placements remain solver inputs. */
function constrained(
  node: VisualNode,
  section: VisualSection,
): boolean {
  if (node.parent === null) return section.layout.columns !== undefined;
  const parent = section.nodes.find((item): boolean => item.id === node.parent);
  return constrainedParent(parent, section);
}
/** Validated parent links are finite; missing parents are rejected by input validation before placement. */
function constrainedParent(
  parent: VisualNode | undefined,
  section: VisualSection,
): boolean {
  if (parent === undefined) return false;
  const group = section.groups.find((item): boolean => item.id === parent.groupId);
  return group?.layout.columns !== undefined || constrained(parent, section);
}
/** Select history locally without parsing cache keys. Pure replay; public arrange reports failure and Authoring owns recovery. */
export function previousNode(
  node: VisualNode,
  section: VisualSection,
  previous: SectionCandidate | null,
): SectionCandidate['nodes'][number] | undefined {
  if (constrained(node, section)) return undefined;
  const prior = previous?.nodes.find((item): boolean => item.id === node.id);
  if (node.treeRow !== undefined) return undefined;
  return prior;
}
/** Explicit columns require derivation even when an independently inspected previous scene is otherwise reusable. */
export function hasColumns(section: VisualSection): boolean {
  return (
    section.layout.columns !== undefined ||
    section.groups.some((group): boolean => group.layout.columns !== undefined)
  );
}
