import type { VisualSection, VisualNode } from '../../contract/records/input.js';
import type { LinearConstraint } from '../../contract/records/problem.js';
import { equation, term } from '../constraints/compile.js';
import { before } from '../constraints/relative.js';
import { isSequenceParticipant } from './eligibility.js';
/** Sequence time flows vertically; participant headers share a horizontal baseline independently of other annotations. */
export function participantConstraints(
  section: VisualSection,
  gap: number,
): readonly LinearConstraint[] {
  if (section.mode !== 'sequence') return [];
  const nodes = section.nodes.filter((node) => isSequenceParticipant(node, section));
  return nodes
    .slice(1)
    .flatMap((node, index) => pair(nodes[index], node, gap, section.layout.direction === 'left'));
}
/** Each adjacent pair shares its baseline and preserves declared left/right participant reading order. */
function pair(
  previous: VisualNode | undefined,
  node: VisualNode,
  gap: number,
  reversed: boolean,
): readonly LinearConstraint[] {
  if (previous === undefined) return [];
  const order: readonly [string, string] = reversed
    ? [node.id, previous.id]
    : [previous.id, node.id];
  return [
    equation(
      `${node.id}:participant-baseline`,
      [term(previous.id, 'y'), term(node.id, 'y', -1)],
      'eq',
      0,
      [previous.id, node.id],
      'required',
    ),
    participantOrder(order, gap),
  ];
}
/** A tuple's two known participant IDs form one explicit horizontal ordering constraint. */
function participantOrder(
  ids: readonly [string, string],
  gap: number,
): LinearConstraint {
  const first = ids[0];
  const second = ids[1];
  return before(`${first}:${second}:participant-order`, first, second, 'x', gap, 'required');
}
