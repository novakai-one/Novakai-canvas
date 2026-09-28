import { participantConstraints } from '../sequence/participants.js';
import type { VisualSection, VisualNode } from '../../contract/records/input.js';
import type { NodeCandidate } from '../../contract/records/candidate.js';
import type { PlacedNode } from '../../contract/records/geometry.js';
import type { LayoutOptions } from '../../contract/types.js';
import type { PositionedInput } from '../constraints/compile.js';
import { compile } from '../constraints/compile.js';
import { relative } from '../constraints/relative.js';
import { sameIds, same, equations, nonoverlap } from './facts.js';
import { reject } from './outcomes.js';
/** Candidate nodes become renderable only after exact measured payload and canonical metadata checks. */
function rebind(
  source: VisualNode,
  candidates: readonly NodeCandidate[],
): PlacedNode {
  const candidate = candidates.find((node) => node.id === source.id);
  if (!candidate) return reject('invalid-input', source.id, 'Candidate node is missing');
  same(source, candidate.measured, source.id);
  same(
    { parent: source.parent, sectionId: source.sectionId },
    { parent: candidate.parent, sectionId: candidate.sectionId },
    source.id,
  );
  return {
    id: source.id,
    parent: source.parent,
    sectionId: source.sectionId,
    measured: source,
    box: candidate.box,
  };
}
/** Independent constraint evaluation uses actual candidate boxes and current authoritative minimums/locks. */
function positioned(node: PlacedNode): PositionedInput {
  return {
    node: {
      id: node.id,
      parent: node.parent,
      minimum: { width: node.measured.width, height: node.measured.height },
      headerHeight: node.measured.headerHeight,
      placement: node.measured.placement,
      container: node.measured.groupId !== null,
    },
    seed: node.box,
    strength: 'weak',
  };
}
/** Ancestor containers intentionally enclose their descendants; separate branches may not overlap. */
function ancestor(
  parent: string,
  child: PlacedNode,
  nodes: readonly PlacedNode[],
): boolean {
  if (child.parent === parent) return true;
  const next = nodes.find((node) => node.id === child.parent);
  if (!next) return false;
  return ancestor(parent, next, nodes);
}
/** Nonoverlap skips only genuine ancestry, already checked for cycles at the input boundary. */
function checkPair(
  a: PlacedNode,
  b: PlacedNode,
  nodes: readonly PlacedNode[],
): void {
  if (ancestor(a.id, b, nodes) || ancestor(b.id, a, nodes)) return;
  nonoverlap(a, b);
}
/** Check identity, content, hard size/position/containment/relative constraints and all unrelated node pairs. */
export function inspectNodes(
  source: VisualSection,
  candidates: readonly NodeCandidate[],
  options: LayoutOptions,
): readonly PlacedNode[] {
  sameIds(
    source.nodes.map((node) => node.id),
    candidates.map((node) => node.id),
    source.id,
  );
  const nodes = source.nodes.map((node) => rebind(node, candidates));
  const problem = compile(nodes.map(positioned), options);
  const constraints = [
    ...problem.constraints,
    ...participantConstraints(source, options.gap[source.layout.gap]),
    ...relative(source.layout, source.nodes, options.gap[source.layout.gap], source.id),
    ...source.groups.flatMap((group) =>
      relative(group.layout, source.nodes, options.gap[group.layout.gap], group.id),
    ),
  ];
  equations(
    constraints,
    nodes.map((node) => ({ id: node.id, box: node.box })),
  );
  nodes.forEach((node, index) =>
    nodes.slice(index + 1).forEach((other) => checkPair(node, other, nodes)),
  );
  return nodes;
}
