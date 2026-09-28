import type { PlacedNode, SequenceEvent, Point } from '../../contract/records/geometry.js';
import type { EventInput, SequenceContext, Body } from './records.js';
import { center } from '../geometry/bounds.js';
import { reject } from '../validation/outcomes.js';
/** Canonical participant identity resolves to its single measured appearance. */
export function participant(
  id: string,
  nodes: readonly PlacedNode[],
): PlacedNode {
  const found = nodes.find((node) => node.measured.objectId === id);
  if (!found) return reject('invalid-input', id, 'Sequence participant is not visible');
  return found;
}
/** Self-messages reserve a visible loop and a full measured label above it. */
function path(
  source: PlacedNode,
  target: PlacedNode,
  y: number,
  width: number,
  gap: number,
): readonly Point[] {
  const a = center(source.box).x;
  const b = center(target.box).x;
  if (source.id === target.id)
    return [
      { x: a, y },
      { x: a + width + gap * 2, y },
      { x: a + width + gap * 2, y: y + gap },
      { x: a, y: y + gap },
    ];
  return [
    { x: a, y },
    { x: b, y },
  ];
}
/** An event occupies its own ordered vertical band: one measured label, one label gap and one sequence gap — never a uniform double slot. */
export function eventBody(
  input: EventInput,
  top: number,
  context: SequenceContext,
): Body {
  const source = participant(input.item.source, context.nodes);
  const target = participant(input.item.target, context.nodes);
  const y = top + input.label.height + context.options.labelGap;
  const points = path(source, target, y, input.label.width, context.options.sequenceGap);
  const x = labelLeft(source, target, input.label.width, context.options.labelGap);
  const event: SequenceEvent = {
    id: input.item.id,
    source: source.id,
    target: target.id,
    points,
    labelBox: { x, y: top, width: input.label.width, height: input.label.height },
    content: input.label,
    marker: input.marker,
    message: input.item.message,
  };
  // A self-call returns below its outgoing leg. Leave a measured label gap after
  // that return leg so the following event label cannot sit on the loop.
  const returnClearance = source.id === target.id ? context.options.labelGap : 0;
  return {
    events: [event],
    fragments: [],
    bottom: y + context.options.sequenceGap + returnClearance,
  };
}
/** Different-participant labels centre on their message; self labels sit in the loop's reserved width. */
function labelLeft(
  source: PlacedNode,
  target: PlacedNode,
  width: number,
  gap: number,
): number {
  if (source.id === target.id) return center(source.box).x + gap;
  return (center(source.box).x + center(target.box).x - width) / 2;
}
