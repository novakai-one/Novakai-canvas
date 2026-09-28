import type { VisualSection, VisualNode } from '../../contract/records/input.js';

/** Sequence lifelines retain legacy participants and add only directly shown modules used by events. */
export function isSequenceParticipant(
  node: VisualNode,
  section: VisualSection,
): boolean {
  if (node.kind === 'participant') return true;
  return (
    node.kind === 'module' &&
    node.groupId === null &&
    eventEndpoints(section).has(node.objectId ?? '')
  );
}

function eventEndpoints(section: VisualSection): ReadonlySet<string> {
  return new Set(
    section.sequence.flatMap((input) =>
      input.item.kind === 'event' ? [input.item.source, input.item.target] : [],
    ),
  );
}
