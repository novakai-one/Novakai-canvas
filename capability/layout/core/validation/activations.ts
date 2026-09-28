import type { VisualSection, VisualSequenceItem } from '../../contract/records/input.js';
import type { SectionCandidate } from '../../contract/records/candidate.js';
import type { PlacedNode } from '../../contract/records/geometry.js';
import { reject } from './outcomes.js';
import { same } from './facts.js';
type Event = Extract<VisualSequenceItem['item'], { kind: 'event' }>;
/** Independent metadata guard does not reuse the activation builder's state or path-combination algorithm. */
export function inspectActivations(
  source: VisualSection,
  candidate: SectionCandidate['sequence'],
  nodes: readonly PlacedNode[],
): void {
  candidate.activations.forEach((activation) =>
    checkActivation(activation, source, candidate, nodes),
  );
}
/** Start metadata must be a receiver activation; a named end must be a sender deactivation on a compatible alternative. */
function checkActivation(
  activation: SectionCandidate['sequence']['activations'][number],
  source: VisualSection,
  candidate: SectionCandidate['sequence'],
  nodes: readonly PlacedNode[],
): void {
  const start = event(activation.fromEvent, source);
  const path = `sequence.activation.${start.id}`;
  same(true, start.activate, path);
  const participant = nodes.find((node) => node.measured.objectId === start.target);
  same(participant?.id, activation.participant, path);
  const geometry = candidate.events.find((item) => item.id === start.id);
  if (activation.box.y < (geometry?.points[0]?.y ?? Infinity) - 0.000001)
    reject('constraint-conflict', path, 'Activation begins before its activating event');
  checkEnd(activation, start, source, candidate, path);
}
/** Null means a scope boundary/open end; only explicit end IDs assert a matching return/deactivation event. */
function checkEnd(
  activation: SectionCandidate['sequence']['activations'][number],
  start: Event,
  source: VisualSection,
  candidate: SectionCandidate['sequence'],
  path: string,
): void {
  if (activation.toEvent === null) return;
  const end = event(activation.toEvent, source);
  same(false, end.activate, path);
  same(start.target, end.source, path);
  checkAlternatives(start, end, source, path);
  const geometry = candidate.events.find((item) => item.id === end.id);
  const bottom = geometry?.points[0]?.y ?? -Infinity;
  if (activation.box.y + activation.box.height > bottom + 0.000001)
    reject('constraint-conflict', path, 'Activation extends after its named deactivation');
}
/** Missing/non-event source identities are never treated as an inferred activation boundary. */
function event(
  id: string,
  source: VisualSection,
): Event {
  const item = source.sequence.find((input) => input.item.id === id)?.item;
  if (item?.kind !== 'event')
    return reject('invalid-input', id, 'Activation event is missing from source');
  return item;
}
/** Independently collect explicit alternative memberships from canonical parent records. */
function alternatives(
  item: VisualSequenceItem['item'],
  source: VisualSection,
): readonly { readonly fragment: string; readonly branch: string }[] {
  if (item.parent === undefined) return [];
  const parent = source.sequence.find((input) => input.item.id === item.parent)?.item;
  if (!parent) return reject('invalid-input', item.id, 'Activation parent is missing');
  return [...alternatives(parent, source), ...membership(item)];
}
/** Only alt branch membership distinguishes incompatible paths; unbranched frames do not invent alternatives. */
function membership(
  item: VisualSequenceItem['item'],
): readonly { readonly fragment: string; readonly branch: string }[] {
  if (item.parent === undefined || item.branch === undefined) return [];
  return [{ fragment: item.parent, branch: item.branch }];
}
/** A shared enclosing alt with different branch IDs proves the two events cannot close one activation. */
function checkAlternatives(
  start: Event,
  end: Event,
  source: VisualSection,
  path: string,
): void {
  const from = alternatives(start, source);
  const to = alternatives(end, source);
  if (from.some((a) => to.some((b) => a.fragment === b.fragment && a.branch !== b.branch)))
    reject(
      'constraint-conflict',
      path,
      'Mutually exclusive alternatives cannot share an activation interval',
      [start.id, end.id],
    );
}
